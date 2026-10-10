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
	if err := os.MkdirAll(filepath.Join(dir, "meta"), 0o755); err != nil {
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

// Meta 是跨局成长（Roguelike meta-progression）的载体：
// 记录解锁的武器/潜行者/计谋、主线通关进度、累计击杀、最高分等。由后端按阈值权威解锁。
//
// 为什么 UnlockedStrats / ClearedStages 必须放在服务端而不是 localStorage：
// 主线是「通关本章 → 解锁下一章 + 本章奖励」的链式结构。这条链如果只活在浏览器内存里，
// 换台设备（或用隐私窗口）打开就退回第一章，玩家会认为"存档丢了"。进度必须落服务端。
type Meta struct {
	PlayerID        string   `json:"playerId"`
	UnlockedWeapons []string `json:"unlockedWeapons"`
	UnlockedChars   []string `json:"unlockedChars"`
	UnlockedStrats  []string `json:"unlockedStrats"`
	ClearedStages   []string `json:"clearedStages"` // 形如 "c2s3"，只记通关的关
	TotalKills      int      `json:"totalKills"`
	BestScore       int      `json:"bestScore"`
	Runs            int      `json:"runs"`
	Souls           int      `json:"souls"` // 元货币，可后续做消费
	Updated         int64    `json:"updated"`
}

// Normalize 把 nil 切片补成空切片。
// 不补的话 encoding/json 会把 nil 序列化成 null，前端 `for (const x of m.clearedStages)`
// 直接抛 TypeError —— 这类崩溃只在"新号第一次请求"时出现，本地测不出来。
func (m *Meta) Normalize() {
	if m.UnlockedWeapons == nil {
		m.UnlockedWeapons = []string{}
	}
	if m.UnlockedChars == nil {
		m.UnlockedChars = []string{}
	}
	if m.UnlockedStrats == nil {
		m.UnlockedStrats = []string{}
	}
	if m.ClearedStages == nil {
		m.ClearedStages = []string{}
	}
}

func (s *Store) SaveMeta(m Meta) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(m)
	return os.WriteFile(filepath.Join(s.dir, "meta", m.PlayerID+".json"), b, 0o644)
}

func (s *Store) LoadMeta(playerID string) (*Meta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(filepath.Join(s.dir, "meta", playerID+".json"))
	if err != nil {
		return nil, err
	}
	var m Meta
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	m.Normalize()
	return &m, nil
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
