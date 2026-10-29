package main

import (
	"bytes"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
	"stream-tribunal/web"
)

func TestRolePhotoUploadIsBoundedAndRequiresAuth(t *testing.T) {
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(previous)
	cfg := config.DefaultConfig()
	cfg.Server.Secret = "secret"
	mux := http.NewServeMux()
	registerRolePhotos(mux, func() *config.Config { return cfg }, obs.NewHub(nil))
	var photo bytes.Buffer
	if err := png.Encode(&photo, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	for _, authorized := range []bool{false, true} {
		var form bytes.Buffer
		writer := multipart.NewWriter(&form)
		file, _ := writer.CreateFormFile("photo", "face.png")
		_, _ = file.Write(photo.Bytes())
		writer.Close()
		req := httptest.NewRequest("POST", "/api/roles/prosecutor/photo", &form)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		if authorized {
			req.Header.Set("X-Tribunal-Secret", "secret")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		want := 401
		if authorized {
			want = 200
		}
		if w.Code != want {
			t.Fatalf("upload: %d, want %d", w.Code, want)
		}
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/roles/prosecutor/photo", nil))
	if !bytes.Equal(w.Body.Bytes(), photo.Bytes()) {
		t.Fatal("uploaded photo not served")
	}
	req := httptest.NewRequest("DELETE", "/api/roles/prosecutor/photo", nil)
	req.Header.Set("X-Tribunal-Secret", "secret")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("reset failed")
	}
	if _, err := os.Stat(rolePhotoPath("prosecutor")); !os.IsNotExist(err) {
		t.Fatal("custom photo remains")
	}
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/roles/unknown/photo", nil))
	if w.Code != 404 {
		t.Fatal("unknown role accepted")
	}
}

func TestDefaultRolePortraitsAreIncluded(t *testing.T) {
	for _, role := range []string{"prosecutor", "advocate"} {
		portrait, err := web.StaticFS.ReadFile("overlay/assets/" + role + "-portrait.png")
		if err != nil || len(portrait) < 1000 || !bytes.HasPrefix(portrait, []byte{137, 80, 78, 71}) {
			t.Fatalf("missing embedded portrait for %s", role)
		}
		if len(roleAssetVersions[role]) != 12 {
			t.Fatalf("portrait %s has no version for cache invalidation", role)
		}
	}
}
