package main

import (
	"net/http"
	"sync"
)

func serializeConfigWrites(next http.Handler) http.Handler {
	var mu sync.Mutex
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Hold through cloning, persistence, publication and dependent service updates.
		if r.Method == http.MethodPut {
			mu.Lock()
			defer mu.Unlock()
		}
		next.ServeHTTP(w, r)
	})
}
