package config

// DefaultPort is the fixed port the server tries first. Using a stable port
// keeps the browser origin constant so the saved password isn't re-prompted.
// If it's in use, the server falls back to a random free port.
const DefaultPort = 8088

type AppConfig struct {
	ConfigPath         string
	IdleTimeoutSeconds int
	BindAddr           string
	Port               int
	RclonePath         string
}

func DefaultConfig() *AppConfig {
	return &AppConfig{
		IdleTimeoutSeconds: 300,
		BindAddr:           "127.0.0.1",
		Port:               DefaultPort,
		RclonePath:         "rclone",
	}
}
