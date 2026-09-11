package server

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"javboss/internal/clouddrive"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCloudDrive2PermissionErrorMessages(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		wantZH string
		wantEN string
	}{
		{
			name: "missing permissions are translated even when wrapped",
			err: fmt.Errorf("test failed: %w", &clouddrive.MissingPermissionsError{Permissions: []string{
				"allow_list", "allow_create_folder", "allow_read", "allow_add_offline_download", "allow_list_offline_downloads",
			}}),
			wantZH: "API 令牌权限不足，缺少：列出文件、创建目录、读取文件、添加离线下载、查看离线下载。请在 CloudDrive2 中编辑该令牌并开启相应权限。",
			wantEN: "list files, create folders, read files, add offline downloads, list offline downloads",
		},
		{
			name:   "RPC permission denial has actionable guidance",
			err:    fmt.Errorf("find CloudDrive2 target folder: %w", status.Error(codes.PermissionDenied, "list permission required")),
			wantZH: "API 令牌权限不足或授权目录受限，请在 CloudDrive2 中检查令牌权限，并确认云端离线目录在授权范围内。",
			wantEN: "authorized scope",
		},
		{
			name:   "unrelated errors keep their details",
			err:    errors.New("connection refused"),
			wantZH: "下载器连接测试失败：connection refused",
			wantEN: "connection refused",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			zh, en := cloudDrive2TestErrorMessages(tc.err)
			if zh != tc.wantZH || !strings.Contains(en, tc.wantEN) {
				t.Fatalf("unexpected error messages: zh=%q en=%q", zh, en)
			}
			if strings.Contains(zh+en, "rpc error") || strings.Contains(zh+en, "allow_list") {
				t.Fatal("permission error exposes internal RPC details instead of friendly labels")
			}
		})
	}
}
