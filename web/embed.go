package web

import "embed"

//go:embed dashboard/*
var StaticFS embed.FS
