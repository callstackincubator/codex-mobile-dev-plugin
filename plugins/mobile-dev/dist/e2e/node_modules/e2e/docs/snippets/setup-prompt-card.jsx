/** Shows a faded prompt preview with an accessible expand and collapse button. */
export const SetupPrompt = ({ children }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="setup-prompt" data-expanded={expanded}>
      <div className="setup-prompt-header">
        <span>Agent prompt</span>
      </div>
      <div id="setup-prompt-content">{children}</div>
      <button
        type="button"
        className="setup-prompt-toggle"
        aria-expanded={expanded}
        aria-controls="setup-prompt-content"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
};
