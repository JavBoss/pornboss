package util

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestIsVideoRecognizesMPEGTransportStreamWithMP4Extension(t *testing.T) {
	path := filepath.Join(t.TempDir(), "SNIS-974.mp4")
	content := makeMPEGTransportStreamHeader(188, 0)
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("write MPEG-TS fixture: %v", err)
	}

	if !IsVideo(path) {
		t.Fatal("IsVideo should recognize MPEG-TS content with an .mp4 extension")
	}
}

func TestIsVideoRecognizesCommonMPEGTransportStreamLayouts(t *testing.T) {
	tests := []struct {
		name       string
		packetSize int
		syncOffset int
	}{
		{name: "TS", packetSize: 188, syncOffset: 0},
		{name: "M2TS", packetSize: 192, syncOffset: 4},
		{name: "192 byte TS", packetSize: 192, syncOffset: 0},
		{name: "204 byte TS", packetSize: 204, syncOffset: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "misnamed.data")
			content := makeMPEGTransportStreamHeader(tt.packetSize, tt.syncOffset)
			if err := os.WriteFile(path, content, 0o600); err != nil {
				t.Fatalf("write MPEG-TS fixture: %v", err)
			}

			if !IsVideo(path) {
				t.Fatalf("IsVideo should recognize packet size %d with sync offset %d", tt.packetSize, tt.syncOffset)
			}
		})
	}
}

func TestIsVideoRecognizesGenericISOBMFFBrandsWithVideoExtensions(t *testing.T) {
	tests := []struct {
		name  string
		brand string
		ext   string
	}{
		{name: "VR MP4", brand: "vr1d", ext: ".mp4"},
		{name: "QuickTime MOV", brand: "qt  ", ext: ".MOV"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "sample"+tt.ext)
			content := make([]byte, 28)
			binary.BigEndian.PutUint32(content[:4], uint32(len(content)))
			copy(content[4:8], "ftyp")
			copy(content[8:12], tt.brand)
			if err := os.WriteFile(path, content, 0o600); err != nil {
				t.Fatalf("write ISO-BMFF fixture: %v", err)
			}

			if !IsVideo(path) {
				t.Fatalf("IsVideo should recognize ISO-BMFF brand %q", tt.brand)
			}
		})
	}
}

func TestIsVideoCandidateUsesKnownExtensionWithoutAcceptingText(t *testing.T) {
	dir := t.TempDir()
	ogvPath := filepath.Join(dir, "sample.ogv")
	if err := os.WriteFile(ogvPath, []byte("candidate validated later by ffprobe"), 0o600); err != nil {
		t.Fatalf("write OGV candidate: %v", err)
	}
	if !IsVideoCandidate(ogvPath) {
		t.Fatal("known video extension should be accepted as an ffprobe candidate")
	}

	textPath := filepath.Join(dir, "sample.txt")
	if err := os.WriteFile(textPath, []byte("ordinary text"), 0o600); err != nil {
		t.Fatalf("write text fixture: %v", err)
	}
	if IsVideoCandidate(textPath) {
		t.Fatal("ordinary text should not be accepted as an ffprobe candidate")
	}
}

func TestParseFFprobeOutputIncludesFormatSize(t *testing.T) {
	meta, err := parseFFprobeOutput([]byte(`{
		"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"30/1"}],
		"format":{"duration":"120.5","size":"987654","bit_rate":"65570","format_name":"mov,mp4"}
	}`), "https://media.example/movie.mp4")
	if err != nil {
		t.Fatalf("parseFFprobeOutput() error = %v", err)
	}
	if meta.Size != 987654 || meta.DurationSeconds != 120.5 {
		t.Fatalf("unexpected metadata: %#v", meta)
	}
}

func TestIsVideoRecognizesRMVBRealMediaSignature(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.rmvb")
	if err := os.WriteFile(path, append([]byte(".RMF\x00\x00\x00\x12"), make([]byte, 32)...), 0o644); err != nil {
		t.Fatalf("write rmvb fixture: %v", err)
	}

	if !IsVideo(path) {
		t.Fatal("IsVideo should accept rmvb files with a RealMedia signature")
	}
}

func TestIsVideoRejectsRMVBWithoutRealMediaSignature(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.rmvb")
	if err := os.WriteFile(path, []byte("not a realmedia file"), 0o644); err != nil {
		t.Fatalf("write rmvb fixture: %v", err)
	}

	if IsVideo(path) {
		t.Fatal("IsVideo should reject rmvb files without a RealMedia signature")
	}
}

func makeMPEGTransportStreamHeader(packetSize, syncOffset int) []byte {
	const packetCount = 4
	content := make([]byte, syncOffset+packetCount*packetSize)
	for packet := 0; packet < packetCount; packet++ {
		content[syncOffset+packet*packetSize] = 0x47
	}
	return content
}

func TestDetectContainerRecognizesRMVBExtension(t *testing.T) {
	if got := detectContainer("rm", "/videos/sample.rmvb"); got != "rmvb" {
		t.Fatalf("detectContainer() = %q, want %q", got, "rmvb")
	}
}

func TestFindFFmpegPathUsesPersistentDataTool(t *testing.T) {
	originalWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalWorkingDir); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})

	baseDir := t.TempDir()
	if err := os.Chdir(baseDir); err != nil {
		t.Fatalf("change working directory: %v", err)
	}
	t.Setenv("JAVBOSS_CONTAINER", "")
	t.Setenv("JAVBOSS_DOCKER", "")

	ignoredEnvPath := filepath.Join(baseDir, "ignored-env-ffmpeg")
	if err := os.WriteFile(ignoredEnvPath, []byte("ignored ffmpeg"), 0o755); err != nil {
		t.Fatalf("write ignored environment FFmpeg fixture: %v", err)
	}
	t.Setenv("FFMPEG_PATH", ignoredEnvPath)

	ffmpegPath := filepath.Join(baseDir, FFmpegToolRelativePath())
	if err := os.MkdirAll(filepath.Dir(ffmpegPath), 0o755); err != nil {
		t.Fatalf("create FFmpeg directory: %v", err)
	}
	if err := os.WriteFile(ffmpegPath, []byte("test ffmpeg"), 0o755); err != nil {
		t.Fatalf("write FFmpeg fixture: %v", err)
	}

	got, err := findFFmpegPath()
	if err != nil {
		t.Fatalf("find FFmpeg: %v", err)
	}
	if filepath.Clean(got) != filepath.Clean(ffmpegPath) {
		t.Fatalf("findFFmpegPath() = %q, want %q", got, ffmpegPath)
	}
}

func TestFindFFmpegPathUsesEnvironmentInContainerMode(t *testing.T) {
	ffmpegPath := filepath.Join(t.TempDir(), "container-ffmpeg")
	if err := os.WriteFile(ffmpegPath, []byte("container ffmpeg"), 0o755); err != nil {
		t.Fatalf("write container FFmpeg fixture: %v", err)
	}
	t.Setenv("JAVBOSS_CONTAINER", "1")
	t.Setenv("JAVBOSS_DOCKER", "")
	t.Setenv("FFMPEG_PATH", ffmpegPath)

	got, err := findFFmpegPath()
	if err != nil {
		t.Fatalf("find FFmpeg: %v", err)
	}
	if filepath.Clean(got) != filepath.Clean(ffmpegPath) {
		t.Fatalf("findFFmpegPath() = %q, want %q", got, ffmpegPath)
	}
}

func TestShouldUseFFmpegPathOnlyInContainerMode(t *testing.T) {
	if shouldUseFFBinaryEnv("ffmpeg", false) {
		t.Fatal("FFMPEG_PATH should be ignored outside container mode")
	}
	if !shouldUseFFBinaryEnv("ffmpeg", true) {
		t.Fatal("FFMPEG_PATH should be used in container mode")
	}
	if !shouldUseFFBinaryEnv("ffprobe", false) {
		t.Fatal("FFPROBE_PATH should remain available outside container mode")
	}
}

func TestFFBinaryCandidatesForBasePlatformOrder(t *testing.T) {
	baseDir := filepath.Join("project", "root")
	binName := "ffmpeg"
	toolPath := filepath.Join("data", "tools", "platform", binName)
	bundledPath := filepath.Join(baseDir, "internal", "bin", binName)
	downloadedPath := filepath.Join(baseDir, toolPath)

	tests := []struct {
		name string
		goos string
		want []string
	}{
		{name: "macOS prioritizes bundled FFmpeg", goos: "darwin", want: []string{bundledPath, downloadedPath}},
		{name: "Windows prioritizes downloaded FFmpeg", goos: "windows", want: []string{downloadedPath, bundledPath}},
		{name: "Linux prioritizes downloaded FFmpeg", goos: "linux", want: []string{downloadedPath, bundledPath}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ffBinaryCandidatesForBase(baseDir, "ffmpeg", binName, tt.goos, toolPath)
			if len(got) != len(tt.want) {
				t.Fatalf("candidate count = %d, want %d", len(got), len(tt.want))
			}
			for index := range tt.want {
				if got[index] != tt.want[index] {
					t.Fatalf("candidate[%d] = %q, want %q", index, got[index], tt.want[index])
				}
			}
		})
	}
}
