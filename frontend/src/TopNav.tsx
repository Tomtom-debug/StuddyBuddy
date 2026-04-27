interface Props {
  activePage: 'landing' | 'app'
  onHome: () => void
  onSearch: () => void
}

export function TopNav({ activePage, onHome, onSearch }: Props): JSX.Element {
  return (
    <nav className="top-nav">
      <div className="top-nav-logo" onClick={onHome} role="button" tabIndex={0}>
        Studdy<em>Buddy</em>
      </div>
      <div className="top-nav-links">
        <button
          className={`top-nav-btn${activePage === 'app' ? ' active' : ''}`}
          onClick={onSearch}
        >
          Search
        </button>
        <button className="top-nav-btn top-nav-btn--soon" disabled>
          Problem Universe
          <span className="top-nav-soon">soon</span>
        </button>
      </div>
    </nav>
  )
}
