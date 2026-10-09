package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// Store 用 JSON 文件落地，零第三方依赖、跨平台。
// 生产可平滑替换为 SQLite / 对象存储，接口不变。
type Store struct {
	dir string
	mu  sync.Mutex
}

func New(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "saves"), 0o755); err != nil {
		return nil, err
	}
	return &Store{dir: dir}, nil
}

// Save 是云存档的核心载体：前端把整局进度序列化成字符串存这里，
// 换电脑时只要带同一个 playerId 即可续上。
type Save struct {
	PlayerID string `json:"playerId"`
	Data     string `json:"data"`
	Updated  int64  `json:"updated"`
}

func (s *Store) SaveGame(playerID, data string, ts int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := filepath.Join(s.dir, "saves", playerID+".json")
	b, _ := json.Marshal(Save{PlayerID: playerID, Data: data, Updated: ts})
	return os.WriteFile(p, b, 0o644)
}

func (s *Store) LoadGame(playerID string) (*Save, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := filepath.Join(s.dir, "saves", playerID+".json")
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var sv Save
	if err := json.Unmarshal(b, &sv); err != nil {
		return nil, err
	}
	return &sv, nil
}

type Score struct {
	PlayerID string `json:"playerId"`
	Name     string `json:"name"`
	Score    int    `json:"score"`
}

func (s *Store) AddScore(sc Score) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := filepath.Join(s.dir, "leaderboard.json")
	var list []Score
	if b, err := os.ReadFile(file); err == nil {
		_ = json.Unmarshal(b, &list)
	}
	list = append(list, sc)
	sortScores(list)
	if len(list) > 100 {
		list = list[:100]
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	return os.WriteFile(file, b, 0o644)
}

func (s *Store) Leaderboard() ([]Score, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := filepath.Join(s.dir, "leaderboard.json")
	b, err := os.ReadFile(file)
	if err != nil {
		return []Score{}, nil
	}
	var list []Score
	_ = json.Unmarshal(b, &list)
	return list, nil
}

func sortScores(list []Score) {
	sort.Slice(list, func(i, j int) bool { return list[i].Score > list[j].Score })
}
