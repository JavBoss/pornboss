package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path"
	"path/filepath"
	"strings"
	"testing"

	pb "javboss/internal/clouddrive/proto"
	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/downloader"
	"javboss/internal/models"

	"github.com/gin-gonic/gin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

type settingsTestCloudDriveServer struct {
	pb.UnimplementedCloudDriveFileSrvServer
	token  string
	folder string
}

func (s *settingsTestCloudDriveServer) GetSystemInfo(context.Context, *emptypb.Empty) (*pb.CloudDriveSystemInfo, error) {
	return &pb.CloudDriveSystemInfo{SystemReady: true}, nil
}

func (s *settingsTestCloudDriveServer) GetApiTokenInfo(_ context.Context, request *pb.StringValue) (*pb.TokenInfo, error) {
	if request.GetValue() == "denied-token" {
		return &pb.TokenInfo{}, nil
	}
	if request.GetValue() != s.token {
		return nil, status.Error(codes.Unauthenticated, "unexpected token")
	}
	return &pb.TokenInfo{Permissions: &pb.TokenPermissions{
		AllowList: true, AllowCreateFolder: true, AllowRead: true,
		AllowAddOfflineDownload: true, AllowListOfflineDownloads: true,
	}}, nil
}

func (s *settingsTestCloudDriveServer) FindFileByPath(ctx context.Context, request *pb.FindFileByPathRequest) (*pb.CloudDriveFile, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	if auth := md.Get("authorization"); len(auth) != 1 || auth[0] != "Bearer "+s.token {
		return nil, status.Error(codes.Unauthenticated, "unexpected authorization")
	}
	if path.Join(request.GetParentPath(), request.GetPath()) != s.folder {
		return nil, status.Error(codes.NotFound, "unexpected folder")
	}
	return &pb.CloudDriveFile{FullPathName: s.folder, IsDirectory: true, CanOfflineDownload: true}, nil
}

func startSettingsTestCloudDrive(t *testing.T, token, folder string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	pb.RegisterCloudDriveFileSrvServer(server, &settingsTestCloudDriveServer{token: token, folder: folder})
	t.Cleanup(server.Stop)
	go func() { _ = server.Serve(listener) }()
	return "http://" + listener.Addr().String()
}

func TestCloudDrive2ChecksDraftWithoutSaving(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "connection-test.db"))
	if err != nil {
		t.Fatal(err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, err := database.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	savedAddress := startSettingsTestCloudDrive(t, "saved-token", "/saved/offline")
	draftAddress := startSettingsTestCloudDrive(t, "draft-token", "/draft/offline")
	saved := &models.DownloaderProviderSettings{
		Provider: models.DownloaderProviderCloudDrive2,
		Address:  savedAddress, APIToken: "saved-token", RemoteFolder: "/saved/offline",
	}
	if err := db.SaveDownloaderProviderSettings(t.Context(), saved); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/downloader/clouddrive2/test", testCloudDrive2)
	draftBody := func(token string) string {
		body, err := json.Marshal(map[string]string{
			"address": " " + draftAddress + " ", "api_token": token, "remote_folder": " /draft/offline ",
		})
		if err != nil {
			t.Fatal(err)
		}
		return string(body)
	}
	for _, tc := range []struct {
		name       string
		body       string
		wantStatus int
		wantFolder string
	}{
		{"no body uses saved settings", "", http.StatusOK, saved.RemoteFolder},
		{"draft uses all current fields and trims whitespace", draftBody(" draft-token "), http.StatusOK, "/draft/offline"},
		{"empty token does not fall back to saved token", draftBody(""), http.StatusBadRequest, ""},
		{"whitespace token is empty", draftBody("  "), http.StatusBadRequest, ""},
		{"missing fields do not fall back", `{}`, http.StatusBadRequest, ""},
		{"null is not saved settings", `null`, http.StatusBadRequest, ""},
		{"malformed body", `{`, http.StatusBadRequest, ""},
		{"invalid field type", `{"address":123}`, http.StatusBadRequest, ""},
		{"oversized token", draftBody(strings.Repeat("x", 16385)), http.StatusBadRequest, ""},
		{"draft permission failure", draftBody("denied-token"), http.StatusBadGateway, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/downloader/clouddrive2/test", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, tc.wantStatus, response.Body.String())
			}
			if tc.wantFolder != "" {
				var result downloader.TestResult
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if result.Folder != tc.wantFolder {
					t.Fatalf("tested folder = %q, want %q", result.Folder, tc.wantFolder)
				}
			}
			stored, err := db.GetDownloaderProviderSettings(t.Context(), saved.Provider)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Address != saved.Address || stored.APIToken != saved.APIToken || stored.RemoteFolder != saved.RemoteFolder || !stored.UpdatedAt.Equal(saved.UpdatedAt) {
				t.Fatal("connection test changed saved settings")
			}
		})
	}
}
