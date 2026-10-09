package config

import "os"

// Config 全部来自环境变量，绝不硬编码机器相关路径，保证工程可移植。
// APP_PORT    : HTTP 端口，默认 8080
// APP_DATA_DIR: 运行时数据目录（存档/排行榜），默认 ./data，可用相对路径
type Config struct {
	Port    string
	DataDir string
}

func Load() Config {
	port := os.Getenv("APP_PORT")
	if port == "" {
		port = "8080"
	}
	dataDir := os.Getenv("APP_DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	return Config{Port: port, DataDir: dataDir}
}
