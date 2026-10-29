package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
	"stream-tribunal/web"
)

func rolePhotoPath(role string) string { return filepath.Join("data", "role-"+role+".png") }

var roleAssetVersions = func() map[string]string {
	versions := make(map[string]string, 2)
	for _, role := range []string{"prosecutor", "advocate"} {
		content, _ := web.StaticFS.ReadFile("overlay/assets/" + role + "-portrait.png")
		hash := sha256.Sum256(content)
		versions[role] = fmt.Sprintf("%x", hash[:6])
	}
	return versions
}()

func rolePhotoURL(role string) string {
	revision := roleAssetVersions[role]
	if file, err := os.Stat(rolePhotoPath(role)); err == nil {
		revision = strconv.FormatInt(file.ModTime().UnixNano(), 10)
	}
	return "/api/roles/" + role + "/photo?v=" + revision
}

func registerRolePhotos(mux *http.ServeMux, current func() *config.Config, hub *obs.Hub) {
	mux.HandleFunc("/api/roles", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", 405)
			return
		}
		if !checkHTTPAuth(current(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		views := make([]map[string]any, 0, 2)
		for _, role := range []string{"prosecutor", "advocate"} {
			_, err := os.Stat(rolePhotoPath(role))
			views = append(views, map[string]any{"role": role, "has_custom": err == nil, "url": rolePhotoURL(role)})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(views)
	})
	mux.HandleFunc("/api/roles/", func(w http.ResponseWriter, r *http.Request) {
		role := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/roles/"), "/photo")
		if (role != "prosecutor" && role != "advocate") || !strings.HasSuffix(r.URL.Path, "/photo") {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodGet {
			w.Header().Set("Cache-Control", "no-store")
			serveImageFile(w, r, rolePhotoPath(role), "overlay/assets/"+role+"-portrait.png")
			return
		}
		if !checkHTTPAuth(current(), r) {
			http.Error(w, "unauthorized", 401)
			return
		}
		switch r.Method {
		case http.MethodPost:
			r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
			if r.ParseMultipartForm(6<<20) != nil {
				http.Error(w, "Изображение должно быть меньше 5 МБ.", 400)
				return
			}
			defer r.MultipartForm.RemoveAll()
			if err := saveUpload(r, 5, rolePhotoPath(role)); err != nil {
				http.Error(w, "Нужен PNG, JPG или WebP до 5 МБ.", 400)
				return
			}
		case http.MethodDelete:
			if err := os.Remove(rolePhotoPath(role)); err != nil && !os.IsNotExist(err) {
				http.Error(w, "Не удалось сбросить портрет.", 500)
				return
			}
		default:
			http.Error(w, "method not allowed", 405)
			return
		}
		hub.BroadcastEvent(obs.EventAppearance, appearanceView(current()))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})
}
