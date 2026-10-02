package web

import "embed"

//go:embed dashboard/* overlay/*
var StaticFS embed.FS
