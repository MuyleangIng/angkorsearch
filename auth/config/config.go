package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port        string
	DatabaseURL string
	FrontendURL string

	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string

	GitHubClientID     string
	GitHubClientSecret string
	GitHubRedirectURL  string

	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	SMTPFrom string
}

func Load() *Config {
	e := func(k, d string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return d
	}
	return &Config{
		Port:        e("AUTH_PORT", "8081"),
		DatabaseURL: e("DATABASE_URL", "postgres://angkor:angkor_secret_2024@postgres:5432/angkorsearch?sslmode=disable"),
		FrontendURL: e("FRONTEND_URL", "http://localhost:3000"),

		GoogleClientID:     e("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: e("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:  e("GOOGLE_REDIRECT_URL", "http://localhost/auth/google/callback"),

		GitHubClientID:     e("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret: e("GITHUB_CLIENT_SECRET", ""),
		GitHubRedirectURL:  e("GITHUB_REDIRECT_URL", "http://localhost/auth/github/callback"),

		SMTPHost: e("SMTP_HOST", ""),
		SMTPPort: func() int {
			p := e("SMTP_PORT", "587")
			n := 587
			fmt.Sscanf(p, "%d", &n)
			return n
		}(),
		SMTPUser: e("SMTP_USER", ""),
		SMTPPass: e("SMTP_PASS", ""),
		SMTPFrom: e("SMTP_FROM", "AngkorSearch <no-reply@angkorsearch.com>"),
	}
}
