package clouddrive

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"

	pb "javboss/internal/clouddrive/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/emptypb"
)

type Client struct {
	conn   *grpc.ClientConn
	rpc    pb.CloudDriveFileSrvClient
	token  string
	origin *url.URL
}

type ConnectionInfo struct {
	UserName        string
	SystemReady     bool
	TokenRoot       string
	CanList         bool
	CanCreateFolder bool
	CanRead         bool
	CanAddOffline   bool
	CanListOffline  bool
	Folder          *pb.CloudDriveFile
}

type DownloadSource struct {
	URL       string
	Headers   http.Header
	ExpiresIn uint64
	Direct    bool
}

func NewClient(address, token string) (*Client, error) {
	origin, target, err := parseAddress(address)
	if err != nil {
		return nil, err
	}
	var transport credentials.TransportCredentials
	if origin.Scheme == "https" {
		transport = credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: origin.Hostname()})
	} else {
		transport = insecure.NewCredentials()
	}
	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(transport))
	if err != nil {
		return nil, fmt.Errorf("connect CloudDrive2: %w", err)
	}
	return &Client{
		conn: conn, rpc: pb.NewCloudDriveFileSrvClient(conn), token: strings.TrimSpace(token), origin: origin,
	}, nil
}

func parseAddress(address string) (*url.URL, string, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return nil, "", errors.New("CloudDrive2 address is required")
	}
	if !strings.Contains(address, "://") {
		address = "http://" + address
	}
	parsed, err := url.Parse(address)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, "", errors.New("CloudDrive2 address must be an http or https host")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, "", errors.New("CloudDrive2 address must not contain a path")
	}
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed, parsed.Host, nil
}

func (c *Client) Close() error { return c.conn.Close() }

func (c *Client) authContext(ctx context.Context) context.Context {
	return metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+c.token)
}

func (c *Client) Test(ctx context.Context, folder string) (*ConnectionInfo, error) {
	system, err := c.rpc.GetSystemInfo(ctx, &emptypb.Empty{})
	if err != nil {
		return nil, fmt.Errorf("get CloudDrive2 system info: %w", err)
	}
	tokenInfo, err := c.rpc.GetApiTokenInfo(ctx, &pb.StringValue{Value: c.token})
	if err != nil {
		return nil, fmt.Errorf("get CloudDrive2 token info: %w", err)
	}
	permissions := tokenInfo.GetPermissions()
	var missing []string
	for _, permission := range []struct {
		name    string
		allowed bool
	}{
		{"allow_list", permissions.GetAllowList()},
		{"allow_create_folder", permissions.GetAllowCreateFolder()},
		{"allow_read", permissions.GetAllowRead()},
		{"allow_add_offline_download", permissions.GetAllowAddOfflineDownload()},
		{"allow_list_offline_downloads", permissions.GetAllowListOfflineDownloads()},
	} {
		if !permission.allowed {
			missing = append(missing, permission.name)
		}
	}
	if len(missing) > 0 {
		return nil, &MissingPermissionsError{Permissions: missing}
	}
	remoteFolder, err := c.Find(ctx, folder)
	if err != nil {
		return nil, fmt.Errorf("find CloudDrive2 target folder: %w", err)
	}
	return &ConnectionInfo{
		UserName: system.GetUserName(), SystemReady: system.GetSystemReady(), TokenRoot: tokenInfo.GetRootDir(),
		CanList: permissions.GetAllowList(), CanCreateFolder: permissions.GetAllowCreateFolder(),
		CanRead: permissions.GetAllowRead(), CanAddOffline: permissions.GetAllowAddOfflineDownload(),
		CanListOffline: permissions.GetAllowListOfflineDownloads(), Folder: remoteFolder,
	}, nil
}

func (c *Client) Find(ctx context.Context, fullPath string) (*pb.CloudDriveFile, error) {
	fullPath = cleanRemotePath(fullPath)
	parent := path.Dir(fullPath)
	name := path.Base(fullPath)
	file, err := c.rpc.FindFileByPath(c.authContext(ctx), &pb.FindFileByPathRequest{ParentPath: parent, Path: name})
	if err == nil && file.GetFullPathName() != "" {
		return file, nil
	}
	files, listErr := c.List(ctx, parent, true)
	if listErr != nil {
		if err != nil {
			return nil, err
		}
		return nil, listErr
	}
	for _, candidate := range files {
		if candidate.GetName() == name || cleanRemotePath(candidate.GetFullPathName()) == fullPath {
			return candidate, nil
		}
	}
	return nil, fmt.Errorf("remote path %s was not found", fullPath)
}

func (c *Client) List(ctx context.Context, folder string, refresh bool) ([]*pb.CloudDriveFile, error) {
	stream, err := c.rpc.GetSubFiles(c.authContext(ctx), &pb.ListSubFileRequest{Path: cleanRemotePath(folder), ForceRefresh: refresh})
	if err != nil {
		return nil, err
	}
	var files []*pb.CloudDriveFile
	for {
		reply, recvErr := stream.Recv()
		if errors.Is(recvErr, io.EOF) {
			break
		}
		if recvErr != nil {
			return nil, recvErr
		}
		files = append(files, reply.GetSubFiles()...)
		if len(files) > 10000 {
			return nil, errors.New("CloudDrive2 directory contains too many entries")
		}
	}
	return files, nil
}

func (c *Client) EnsureFolder(ctx context.Context, parent, name string) (string, error) {
	parent = cleanRemotePath(parent)
	files, err := c.List(ctx, parent, true)
	if err != nil {
		return "", err
	}
	for _, file := range files {
		if file.GetName() == name && file.GetIsDirectory() {
			return cleanRemotePath(file.GetFullPathName()), nil
		}
	}
	result, err := c.rpc.CreateFolder(c.authContext(ctx), &pb.CreateFolderRequest{ParentPath: parent, FolderName: name})
	if err != nil {
		return "", err
	}
	if result.GetResult() == nil || !result.GetResult().GetSuccess() {
		message := "CloudDrive2 did not create the job folder"
		if result.GetResult() != nil && strings.TrimSpace(result.GetResult().GetErrorMessage()) != "" {
			message = result.GetResult().GetErrorMessage()
		}
		return "", errors.New(message)
	}
	if created := result.GetFolderCreated(); created != nil && created.GetFullPathName() != "" {
		return cleanRemotePath(created.GetFullPathName()), nil
	}
	return cleanRemotePath(path.Join(parent, name)), nil
}

func (c *Client) AddOffline(ctx context.Context, magnet, folder string) error {
	checkAfter := uint64(10)
	result, err := c.rpc.AddOfflineFiles(c.authContext(ctx), &pb.AddOfflineFileRequest{
		Urls: magnet, ToFolder: cleanRemotePath(folder), CheckFolderAfterSecs: &checkAfter,
	})
	if err != nil {
		return err
	}
	if !result.GetSuccess() {
		return errors.New(strings.TrimSpace(result.GetErrorMessage()))
	}
	return nil
}

func (c *Client) OfflineFiles(ctx context.Context, folder string) ([]*pb.OfflineFile, error) {
	refresh := true
	result, err := c.rpc.ListOfflineFilesByPath(c.authContext(ctx), &pb.FileRequest{Path: cleanRemotePath(folder), ForceRefresh: &refresh})
	if err != nil {
		return nil, err
	}
	return result.GetOfflineFiles(), nil
}

func (c *Client) WalkFiles(ctx context.Context, folder string) ([]*pb.CloudDriveFile, error) {
	var result []*pb.CloudDriveFile
	queue := []string{cleanRemotePath(folder)}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		files, err := c.List(ctx, current, true)
		if err != nil {
			return nil, err
		}
		for _, file := range files {
			if file.GetIsDirectory() {
				queue = append(queue, cleanRemotePath(file.GetFullPathName()))
			} else if file.GetIsCloudFile() || file.GetFileType() == pb.CloudDriveFile_File {
				result = append(result, file)
			}
		}
		if len(result)+len(queue) > 10000 {
			return nil, errors.New("CloudDrive2 job contains too many files")
		}
	}
	return result, nil
}

func (c *Client) DownloadSource(ctx context.Context, remotePath string) (*DownloadSource, error) {
	info, err := c.rpc.GetDownloadUrlPath(c.authContext(ctx), &pb.GetDownloadUrlPathRequest{
		Path: cleanRemotePath(remotePath), Preview: false, LazyRead: false, GetDirectUrl: true,
	})
	if err != nil {
		return nil, err
	}
	headers := make(http.Header)
	for key, value := range info.GetAdditionalHeaders() {
		if strings.EqualFold(key, "Host") || strings.EqualFold(key, "Content-Length") {
			continue
		}
		headers.Set(key, value)
	}
	if value := strings.TrimSpace(info.GetUserAgent()); value != "" {
		headers.Set("User-Agent", value)
	}
	if direct := strings.TrimSpace(info.GetDirectUrl()); direct != "" {
		if _, err := validHTTPURL(direct); err != nil {
			return nil, err
		}
		return &DownloadSource{URL: direct, Headers: headers, ExpiresIn: info.GetExpiresIn(), Direct: true}, nil
	}
	rawPath := strings.TrimSpace(info.GetDownloadUrlPath())
	if rawPath == "" {
		return nil, errors.New("CloudDrive2 returned no download URL")
	}
	rawPath = strings.ReplaceAll(rawPath, "{SCHEME}", c.origin.Scheme)
	rawPath = strings.ReplaceAll(rawPath, "{HOST}", c.origin.Host)
	rawPath = strings.ReplaceAll(rawPath, "{PREVIEW}", "false")
	resolved, err := c.origin.Parse(rawPath)
	if err != nil {
		return nil, fmt.Errorf("resolve CloudDrive2 download URL: %w", err)
	}
	if _, err := validHTTPURL(resolved.String()); err != nil {
		return nil, err
	}
	return &DownloadSource{URL: resolved.String(), Headers: headers, ExpiresIn: info.GetExpiresIn()}, nil
}

func validHTTPURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("CloudDrive2 returned an invalid download URL")
	}
	return parsed, nil
}

func cleanRemotePath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		return "/"
	}
	return path.Clean("/" + strings.TrimLeft(value, "/"))
}
