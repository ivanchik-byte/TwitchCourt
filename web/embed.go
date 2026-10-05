package web

import "embed"

//go:embed dashboard/* overlay/* overlay/assets/* overlay/assets/backgrounds/* overlay/sfx/*
var StaticFS embed.FS
