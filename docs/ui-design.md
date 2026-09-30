# Review workspace design

The September 30 redesign follows Brian's explicit request for a modern interface with fewer scattered small texts. The design-taste-frontend skill supplies hierarchy, spacing, theme, contrast, and interaction guidance. Its marketing-page imagery, hero, typography, and framework defaults do not apply to this native product workspace.

Design read: a personal chess learning workspace, with a calm, board-first language using existing host styles and Chessground. DESIGN_VARIANCE 4, MOTION_INTENSITY 3, VISUAL_DENSITY 3. Preserve the green board, pawn artwork, host typography and theme, and canonical semantic-tool interaction. Use one 8-pixel corner system and green accent; classification colors convey actual grades.

The existing native view was audited: a permanent import form and picker, pending score text, navigation, progress, variation input, saved history, fixture attribution, and connection/debug summaries all stacked around the board. Most copy used 11–13-pixel text. The floating native composer could overlap secondary controls until docked; this is host layout, separate from the plugin HTML.

The revised interface uses readable 14–16-pixel controls, player/color/turn bars around the board, an account/game disclosure, grouped ready-only assessments, actual analysis progress, and actionable key moments. Secondary variations, saved history, and piece descriptions are disclosed when needed. Retry supplies contextual attempt feedback and records assistance. Connection/debug summaries remain accessible to screen readers rather than occupying the visual flow. Empty, loading, failed, pending, ready, hidden-retry, attempted-retry, and variation states derive from real backend state.

Native chat holds explanations; the plugin provides the interactive review and checked evidence. Theme changes use host tokens across the whole view. Focus returns to visible controls after panels close, and reduced-motion preferences disable transitions. Legal move input, session identity, revision guards, and backend/display/context acknowledgement boundaries remain authoritative. See the final native inspection evidence in [verification](verification.md).
