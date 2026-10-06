BINARY := StreamTribunal
DIST := dist

.PHONY: run test vet build build-win package-win frontend overlay clean

frontend:
	cd web/frontend && npm ci --no-audit --no-fund && npm run build

overlay:
	sh web/build.sh

run:
	go run ./cmd/server

test:
	go test ./... -race -count=1

vet:
	go vet ./...

build: frontend overlay
	go build -o $(DIST)/$(BINARY) ./cmd/server

build-win: frontend overlay
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o $(DIST)/$(BINARY).exe ./cmd/server

package-win: build-win
	cp config.default.yaml $(DIST)/config.yaml
	powershell -NoProfile -Command "Compress-Archive -Force '$(DIST)/$(BINARY).exe','$(DIST)/config.yaml','README.md','LICENSE' '$(DIST)/$(BINARY)-windows-amd64.zip'" 2>/dev/null || \
		zip -j $(DIST)/$(BINARY)-windows-amd64.zip $(DIST)/$(BINARY).exe $(DIST)/config.yaml README.md LICENSE

clean:
	rm -rf $(DIST)
