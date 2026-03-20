export interface Episode {
  title: string;
  descr: string;
  imdb_rating: number;
}

export type Subject = 'math' | 'cs'

export interface MathSearchResult {
  problem_id: number
  problem_raw: string
  answer: string
  similarity_score: number
}

export interface LeetcodeSearchResult {
  problem_id: number
  title: string
  description: string
  difficulty: string | number
  acceptance_rate: number | string
  url?: string
  solution_link?: string
  companies?: string[]
  related_topics?: string[]
  similar_questions?: string[]
  similarity_score: number
}

export type SearchResult = MathSearchResult | LeetcodeSearchResult

export interface SearchResponse {
  subject: Subject
  query: string
  query_combined_text?: string
  results: SearchResult[]
  message?: string
}
