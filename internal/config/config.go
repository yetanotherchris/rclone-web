package config

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
		Port:               0,
		RclonePath:         "rclone",
	}
}
