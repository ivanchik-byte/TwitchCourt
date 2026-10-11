package web

import "embed"

//go:embed dashboard/* overlay/*.html overlay/*.css overlay/*.js overlay/assets/*.jpg overlay/assets/*.png overlay/assets/backgrounds/*.jpg overlay/sfx/*.mp3
var StaticFS embed.FS
