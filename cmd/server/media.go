package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"stream-tribunal/web"
)

var judgePhotoExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
}

func judgePhotoPath() string {
	if _, err := os.Stat(filepath.Join("data", "judge.png")); err == nil {
		return filepath.Join("data", "judge.png")
	}
	return filepath.Join("data", "judge.jpg")
}

func serveJudgePhoto(w http.ResponseWriter, r *http.Request) {
	if _, err := os.Stat(judgePhotoPath()); err == nil {
		serveImageFile(w, r, judgePhotoPath(), "")
		return
	}
	if _, err := web.StaticFS.ReadFile("overlay/assets/judge.png"); err == nil {
		serveImageFile(w, r, judgePhotoPath(), "overlay/assets/judge.png")
		return
	}
	serveImageFile(w, r, judgePhotoPath(), "overlay/assets/judge.jpg")
}

func serveCourtBg(w http.ResponseWriter, r *http.Request) {
	serveImageFile(w, r, courtBgPath(), "overlay/assets/backgrounds/court_zoom_medium.jpg")
}

func serveImageFile(w http.ResponseWriter, r *http.Request, dataPath, embedPath string) {
	if raw, err := os.ReadFile(dataPath); err == nil {
		w.Header().Set("Content-Type", http.DetectContentType(raw))
		w.Write(raw)
		return
	}
	raw, err := web.StaticFS.ReadFile(embedPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(raw))
	w.Write(raw)
}

func saveUpload(r *http.Request, maxMB int, dest string) error {
	file, header, err := r.FormFile("photo")
	if err != nil {
		return fmt.Errorf("need multipart photo: %w", err)
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !judgePhotoExts[ext] {
		return fmt.Errorf("want jpg, png or webp")
	}
	limit := int64(maxMB) * 1024 * 1024
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return err
	}
	if int64(len(raw)) > limit {
		return fmt.Errorf("photo over %d MB", maxMB)
	}
	if kind := http.DetectContentType(raw); !strings.HasPrefix(kind, "image/") {
		return fmt.Errorf("not an image")
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), "upload-*.jpg")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dest)
}

func saveJudgePhoto(r *http.Request) error {
	return saveUpload(r, 5, judgePhotoPath())
}

func courtBgPath() string {
	return filepath.Join("data", "court_bg.jpg")
}

func saveCourtBg(r *http.Request) error {
	return saveUpload(r, 8, courtBgPath())
}
