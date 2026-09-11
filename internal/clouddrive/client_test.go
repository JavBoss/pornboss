package clouddrive

import (
	"context"
	"errors"
	"reflect"
	"testing"

	pb "javboss/internal/clouddrive/proto"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/emptypb"
)

type connectionTestRPC struct {
	pb.CloudDriveFileSrvClient
	permissions *pb.TokenPermissions
	folderCalls int
}

func (r *connectionTestRPC) GetSystemInfo(context.Context, *emptypb.Empty, ...grpc.CallOption) (*pb.CloudDriveSystemInfo, error) {
	return &pb.CloudDriveSystemInfo{SystemReady: true}, nil
}

func (r *connectionTestRPC) GetApiTokenInfo(context.Context, *pb.StringValue, ...grpc.CallOption) (*pb.TokenInfo, error) {
	return &pb.TokenInfo{Permissions: r.permissions}, nil
}

func (r *connectionTestRPC) FindFileByPath(context.Context, *pb.FindFileByPathRequest, ...grpc.CallOption) (*pb.CloudDriveFile, error) {
	r.folderCalls++
	return &pb.CloudDriveFile{FullPathName: "/offline", IsDirectory: true, CanOfflineDownload: true}, nil
}

func TestConnectionChecksPermissionsBeforeReadingFolder(t *testing.T) {
	for _, tc := range []struct {
		name    string
		disable func(*pb.TokenPermissions)
		missing []string
	}{
		{name: "all required permissions"},
		{name: "list", disable: func(p *pb.TokenPermissions) { p.AllowList = false }, missing: []string{"allow_list"}},
		{name: "create folder", disable: func(p *pb.TokenPermissions) { p.AllowCreateFolder = false }, missing: []string{"allow_create_folder"}},
		{name: "read", disable: func(p *pb.TokenPermissions) { p.AllowRead = false }, missing: []string{"allow_read"}},
		{name: "add offline", disable: func(p *pb.TokenPermissions) { p.AllowAddOfflineDownload = false }, missing: []string{"allow_add_offline_download"}},
		{name: "list offline", disable: func(p *pb.TokenPermissions) { p.AllowListOfflineDownloads = false }, missing: []string{"allow_list_offline_downloads"}},
		{name: "no permission metadata", missing: []string{"allow_list", "allow_create_folder", "allow_read", "allow_add_offline_download", "allow_list_offline_downloads"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			permissions := &pb.TokenPermissions{
				AllowList: true, AllowCreateFolder: true, AllowRead: true,
				AllowAddOfflineDownload: true, AllowListOfflineDownloads: true,
			}
			if tc.disable != nil {
				tc.disable(permissions)
			} else if len(tc.missing) > 0 {
				permissions = nil
			}
			rpc := &connectionTestRPC{permissions: permissions}
			client := &Client{rpc: rpc, token: "test-token"}
			info, err := client.Test(t.Context(), "/offline")
			if len(tc.missing) == 0 {
				if err != nil || info == nil || info.Folder.GetFullPathName() != "/offline" || rpc.folderCalls != 1 {
					t.Fatalf("expected successful folder check; info=%v err=%v calls=%d", info, err, rpc.folderCalls)
				}
				return
			}
			var missing *MissingPermissionsError
			if !errors.As(err, &missing) || !reflect.DeepEqual(missing.Permissions, tc.missing) {
				t.Fatalf("error = %v, want missing permissions %v", err, tc.missing)
			}
			if rpc.folderCalls != 0 {
				t.Fatal("folder was read before required permissions were checked")
			}
		})
	}
}
