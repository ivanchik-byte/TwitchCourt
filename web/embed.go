package web

import "embed"

//go:embed dashboard/* overlay/* overlay/assets/* overlay/sfx/*
var StaticFS embed.FS
