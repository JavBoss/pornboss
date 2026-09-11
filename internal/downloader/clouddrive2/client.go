package clouddrive2

import (
	"context"
	"errors"
	"strings"

	"javboss/internal/clouddrive"
	cloudpb "javboss/internal/clouddrive/proto"
	"javboss/internal/downloader"
)

type Client struct {
	client *clouddrive.Client
}

func New(address, token string) (*Client, error) {
	client, err := clouddrive.NewClient(address, token)
	if err != nil {
		return nil, err
	}
	return &Client{client: client}, nil
}

func (c *Client) Close() error { return c.client.Close() }

func (c *Client) Test(ctx context.Context, folder string) (*downloader.TestResult, error) {
	info, err := c.client.Test(ctx, folder)
	if err != nil {
		return nil, err
	}
	if info.Folder == nil || !info.Folder.GetIsDirectory() || !info.Folder.GetCanOfflineDownload() {
		return nil, errors.New("CloudDrive2 target folder does not support offline downloads")
	}
	return &downloader.TestResult{
		Provider: "clouddrive2", UserName: info.UserName, Folder: info.Folder.GetFullPathName(),
		Details: map[string]any{"system_ready": info.SystemReady, "token_root": info.TokenRoot},
	}, nil
}

func (c *Client) EnsureFolder(ctx context.Context, parent, name string) (string, error) {
	return c.client.EnsureFolder(ctx, parent, name)
}

func (c *Client) StartOffline(ctx context.Context, magnet, folder, infoHash string) (string, error) {
	if err := c.client.AddOffline(ctx, magnet, folder); err != nil {
		return "", err
	}
	return strings.ToLower(strings.TrimSpace(infoHash)), nil
}

func (c *Client) OfflineStatus(ctx context.Context, _ string, folder, infoHash string) (*downloader.OfflineStatus, error) {
	files, err := c.client.OfflineFiles(ctx, folder)
	if err != nil {
		return nil, err
	}
	for _, file := range files {
		candidate := strings.ToLower(strings.TrimSpace(file.GetInfoHash()))
		if candidate == "" {
			candidate = infoHashFromMagnet(file.GetUrl())
		}
		if candidate != strings.ToLower(strings.TrimSpace(infoHash)) {
			continue
		}
		switch file.GetStatus() {
		case cloudpb.OfflineFileStatus_OFFLINE_FINISHED:
			return &downloader.OfflineStatus{State: downloader.OfflineComplete}, nil
		case cloudpb.OfflineFileStatus_OFFLINE_ERROR:
			return &downloader.OfflineStatus{State: downloader.OfflineFailed, Message: "CloudDrive2 reported an offline download error"}, nil
		default:
			return &downloader.OfflineStatus{State: downloader.OfflineRunning}, nil
		}
	}
	return &downloader.OfflineStatus{State: downloader.OfflineNotFound}, nil
}

func (c *Client) WalkFiles(ctx context.Context, folder string) ([]downloader.RemoteFile, error) {
	files, err := c.client.WalkFiles(ctx, folder)
	if err != nil {
		return nil, err
	}
	result := make([]downloader.RemoteFile, 0, len(files))
	for _, file := range files {
		result = append(result, downloader.RemoteFile{
			Path: file.GetFullPathName(), Name: file.GetName(), Size: file.GetSize(),
		})
	}
	return result, nil
}

func (c *Client) DownloadSource(ctx context.Context, remotePath string) (*downloader.DownloadSource, error) {
	source, err := c.client.DownloadSource(ctx, remotePath)
	if err != nil {
		return nil, err
	}
	return &downloader.DownloadSource{URL: source.URL, Headers: source.Headers}, nil
}

func (c *Client) CancelOffline(context.Context, string) error {
	return nil
}

func infoHashFromMagnet(value string) string {
	value = strings.ToLower(value)
	const marker = "urn:btih:"
	index := strings.Index(value, marker)
	if index < 0 {
		return ""
	}
	value = value[index+len(marker):]
	if end := strings.IndexAny(value, "&?#"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

var _ downloader.Client = (*Client)(nil)
