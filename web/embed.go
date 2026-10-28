package web

import "embed"

//go:embed dashboard/* overlay/*.html overlay/*.css overlay/*.js overlay/assets/*.jpg overlay/assets/*.png overlay/assets/*.woff2 overlay/assets/*-OFL.txt overlay/assets/backgrounds/*.jpg overlay/assets/backgrounds/*.png overlay/sfx/*.mp3
var StaticFS embed.FS
