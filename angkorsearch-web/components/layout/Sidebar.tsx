import KnowledgePanel from '@/components/widgets/KnowledgePanel'
import type { SearchResult } from '@/types'

interface Props {
  result?: SearchResult | null
  image?:  string
}

export default function Sidebar({ result, image }: Props) {
  if (!result) return null
  return (
    <aside className="hidden xl:block w-80 flex-shrink-0">
      <KnowledgePanel result={result} image={image} />
    </aside>
  )
}
