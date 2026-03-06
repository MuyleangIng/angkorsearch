'use client'
import Link from 'next/link'
import { motion } from 'framer-motion'
import ThemeToggle from '@/components/ui/ThemeToggle'

const CONTRIBUTORS = [
  { login: 'MuyleangIng',     id: 116934056,  role: 'Creator & Lead Engineer' },
  { login: 'ingdavann',       id: 112704849,  role: 'Contributor' },
  { login: 'Jessiebrownleo',  id: 154412765,  role: 'Contributor' },
  { login: 'MengseuThoeng',   id: 152089680,  role: 'Contributor' },
  { login: 'prox-dex',        id: 225996771,  role: 'Contributor' },
  { login: 'YithSopheaktra8', id: 102577536,  role: 'Contributor' },
]

const TECH_STACK = [
  { name: 'Next.js 14',  desc: 'Frontend framework',      color: 'text-content' },
  { name: 'C++20',       desc: 'API server & crawler',    color: 'text-blue' },
  { name: 'PostgreSQL',  desc: 'Full-text search index',  color: 'text-blue' },
  { name: 'Redis',       desc: 'Queue & caching',         color: 'text-red' },
  { name: 'Ollama',      desc: 'Local AI answers',        color: 'text-purple' },
  { name: 'Docker',      desc: 'Container orchestration', color: 'text-blue' },
  { name: 'Tailwind CSS','desc': 'Styling',               color: 'text-green' },
  { name: 'Framer Motion','desc': 'Animations',           color: 'text-yellow' },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-primary text-content">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="AngkorSearch" className="h-8 w-auto" />
          <span className="text-sm font-semibold text-content hidden sm:block">AngkorSearch</span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/search?q=Cambodia&tab=all" className="text-xs bg-blue text-white px-3 py-1.5 rounded-full hover:bg-blue/80 transition-all">
            Search
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-16">

        {/* Hero */}
        <motion.section
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex justify-center mb-6">
            <img src="/logo.png" alt="AngkorSearch" className="h-20 w-auto" draggable={false} />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-content mb-3">AngkorSearch</h1>
          <p className="text-muted text-lg mb-6">Cambodia&apos;s open search engine — built to index and surface Khmer & English content from across the web.</p>

          {/* Made with love */}
          <div className="inline-flex flex-wrap items-center justify-center gap-2 bg-card border border-border rounded-2xl px-6 py-4 text-sm">
            <span className="text-muted">Made with</span>
            <span className="text-red text-lg">♥</span>
            <span className="text-muted">by</span>
            <a href="https://muyleanging.com" target="_blank" rel="noreferrer"
              className="font-semibold text-blue hover:underline">
              Ing Muyleang
            </a>
            <span className="text-border mx-1">|</span>
            <a href="https://khmerstack.muyleanging.com" target="_blank" rel="noreferrer"
              className="font-semibold text-blue hover:underline flex items-center gap-1">
              KhmerStack
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
        </motion.section>

        {/* About the project */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-blue rounded-full" />
            About the Project
          </h2>
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4 text-sm text-muted leading-relaxed">
            <p>
              AngkorSearch is a fully self-hosted search engine built from scratch in C++ and Next.js. It crawls Cambodian websites, indexes Khmer and English content using PostgreSQL full-text search, and serves results through a fast REST API — all running locally with no dependence on external search APIs.
            </p>
            <p>
              The project includes a multi-worker crawler, an AI-powered answer feature via Ollama, real-time admin monitoring, dark/light theming, and a Knowledge Panel for top results — inspired by how major search engines present information.
            </p>
            <p>
              AngkorSearch is an open-source project under <strong className="text-content">KhmerStack</strong> — a community initiative to build modern tech infrastructure for Cambodia.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <a href="https://muyleanging.com" target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-blue hover:underline text-xs font-medium">
                <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
                </svg>
                muyleanging.com — Portfolio
              </a>
              <a href="https://khmerstack.muyleanging.com" target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-blue hover:underline text-xs font-medium">
                <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                </svg>
                khmerstack.muyleanging.com — KhmerStack
              </a>
            </div>
          </div>
        </motion.section>

        {/* Tech Stack */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-green rounded-full" />
            Tech Stack
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TECH_STACK.map((t, i) => (
              <motion.div
                key={t.name}
                className="bg-card border border-border rounded-xl p-4 hover:border-blue/30 transition-all"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.05 }}
              >
                <div className={`text-sm font-bold ${t.color} mb-1`}>{t.name}</div>
                <div className="text-xs text-muted">{t.desc}</div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Contributors */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <h2 className="text-xl font-bold text-content mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-purple rounded-full" />
            Contributors
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
            {CONTRIBUTORS.map((c, i) => (
              <motion.a
                key={c.login}
                href={`https://github.com/${c.login}`}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col items-center gap-2 bg-card border border-border rounded-xl p-4 hover:border-blue/40 hover:shadow-lg hover:shadow-black/20 transition-all group"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.07 }}
              >
                <div className="relative">
                  <img
                    src={`https://avatars.githubusercontent.com/u/${c.id}?v=4&s=80`}
                    alt={c.login}
                    className="w-14 h-14 rounded-full border-2 border-border group-hover:border-blue/40 transition-all object-cover"
                    onError={e => {
                      e.currentTarget.src = `https://ui-avatars.com/api/?name=${c.login}&background=21262d&color=8b949e&size=80`
                    }}
                  />
                  {c.login === 'MuyleangIng' && (
                    <span className="absolute -top-1 -right-1 text-[10px] bg-blue text-white px-1 py-0.5 rounded-full font-bold leading-none">
                      ★
                    </span>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-content text-xs font-semibold truncate w-full">{c.login}</p>
                  <p className="text-muted text-[10px] mt-0.5 truncate w-full">{c.role}</p>
                </div>
              </motion.a>
            ))}
          </div>
          <p className="text-muted text-xs mt-4 text-center">
            KhmerStack org members on{' '}
            <a href="https://github.com/KhmerStack" target="_blank" rel="noreferrer" className="text-blue hover:underline">
              github.com/KhmerStack
            </a>
          </p>
        </motion.section>

        {/* Open Source */}
        <motion.section
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <div className="bg-card border border-border rounded-2xl p-8">
            <div className="text-4xl mb-4">🇰🇭</div>
            <h3 className="text-lg font-bold text-content mb-2">Open Source & Free</h3>
            <p className="text-muted text-sm mb-6 max-w-md mx-auto">
              AngkorSearch is open source. Built for Cambodia, by Cambodians — to make the web more accessible in Khmer.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="https://github.com/MuyleangIng"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 bg-hover border border-border rounded-full px-4 py-2 text-sm text-content hover:border-blue/40 transition-all"
              >
                <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                github.com/MuyleangIng
              </a>
              <a
                href="https://muyleanging.com"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 bg-blue/10 border border-blue/30 rounded-full px-4 py-2 text-sm text-blue hover:bg-blue/20 transition-all"
              >
                muyleanging.com
              </a>
            </div>
          </div>
        </motion.section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-5 mt-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            Made with <span className="text-red">♥</span> by
            <a href="https://muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline ml-1">Ing Muyleang</a>
            <span className="mx-1.5 text-border">|</span>
            <a href="https://khmerstack.muyleanging.com" target="_blank" rel="noreferrer" className="text-blue hover:underline">KhmerStack</a>
          </span>
          <Link href="/" className="hover:text-content transition-colors">Back to Search</Link>
        </div>
      </footer>
    </div>
  )
}
