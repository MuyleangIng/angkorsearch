package db

import (
	"context"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PermissionStore caches role → []permission mappings from the database.
// Loaded once at startup; call Reload() if roles change at runtime.
type PermissionStore struct {
	mu    sync.RWMutex
	cache map[string][]string // roleName → []permissionName
}

func NewPermissionStore() *PermissionStore {
	return &PermissionStore{cache: make(map[string][]string)}
}

func (ps *PermissionStore) Load(pool *pgxpool.Pool) error {
	rows, err := pool.Query(context.Background(), `
		SELECT r.name, p.name
		FROM role_permissions rp
		JOIN roles r ON r.id = rp.role_id
		JOIN permissions p ON p.id = rp.permission_id
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	m := make(map[string][]string)
	for rows.Next() {
		var role, perm string
		if err := rows.Scan(&role, &perm); err != nil {
			return err
		}
		m[role] = append(m[role], perm)
	}

	ps.mu.Lock()
	ps.cache = m
	ps.mu.Unlock()
	return nil
}

func (ps *PermissionStore) Get(role string) []string {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	perms := ps.cache[role]
	if perms == nil {
		return []string{}
	}
	return perms
}
