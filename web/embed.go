package web

import "embed"

//go:embed overlay/* dashboard/*
var StaticFS embed.FS
