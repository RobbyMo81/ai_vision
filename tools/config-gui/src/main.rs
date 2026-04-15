use crossterm::{
    event::{self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap},
    Frame, Terminal,
};
use std::{
    collections::HashMap,
    fs,
    io::{self, stdout},
    path::PathBuf,
};

// ---------------------------------------------------------------------------
// Model catalogue — single source of truth
// ---------------------------------------------------------------------------

struct ModelInfo {
    id: &'static str,
    display: &'static str,
    tier: &'static str,
}

const ANTHROPIC_MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "claude-haiku-4-5-20251001",
        display: "Haiku 4.5",
        tier: "Fastest · Cheapest",
    },
    ModelInfo {
        id: "claude-sonnet-4-6",
        display: "Sonnet 4.6",
        tier: "Balanced · Recommended",
    },
    ModelInfo {
        id: "claude-opus-4-6",
        display: "Opus 4.6",
        tier: "Most Capable · Most Expensive",
    },
];

const OPENAI_MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "gpt-4o-mini",
        display: "GPT-4o Mini",
        tier: "Fastest · Cheapest",
    },
    ModelInfo {
        id: "gpt-4o",
        display: "GPT-4o",
        tier: "Balanced · Recommended",
    },
    ModelInfo {
        id: "o3",
        display: "o3",
        tier: "Most Capable · Most Expensive",
    },
];

const PROVIDERS: &[&str] = &["anthropic", "openai"];

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

#[derive(Clone, PartialEq)]
enum Screen {
    Provider,
    Model,
    ApiKey,
    Confirm,
}

struct App {
    screen: Screen,
    provider_idx: usize,
    model_idx: usize,
    api_key: String,
    api_key_visible: bool,
    env_path: PathBuf,
    saved: bool,
    status_msg: Option<String>,
}

impl App {
    fn new(env_path: PathBuf) -> Self {
        let existing = load_env(&env_path);

        let provider_idx = match existing
            .get("STAGEHAND_LLM_PROVIDER")
            .map(|s| s.as_str())
        {
            Some("openai") => 1,
            _ => 0,
        };

        let current_model = existing
            .get("STAGEHAND_LLM_MODEL")
            .cloned()
            .unwrap_or_default();

        let models = if provider_idx == 0 {
            ANTHROPIC_MODELS
        } else {
            OPENAI_MODELS
        };
        let model_idx = models
            .iter()
            .position(|m| m.id == current_model)
            .unwrap_or(1);

        let api_key_var = if provider_idx == 0 {
            "ANTHROPIC_API_KEY"
        } else {
            "OPENAI_API_KEY"
        };
        let api_key = existing.get(api_key_var).cloned().unwrap_or_default();

        Self {
            screen: Screen::Provider,
            provider_idx,
            model_idx,
            api_key,
            api_key_visible: false,
            env_path,
            saved: false,
            status_msg: None,
        }
    }

    fn provider_name(&self) -> &'static str {
        PROVIDERS[self.provider_idx]
    }

    fn models(&self) -> &'static [ModelInfo] {
        if self.provider_idx == 0 {
            ANTHROPIC_MODELS
        } else {
            OPENAI_MODELS
        }
    }

    fn selected_model(&self) -> &'static ModelInfo {
        &self.models()[self.model_idx]
    }

    fn api_key_var(&self) -> &'static str {
        if self.provider_idx == 0 {
            "ANTHROPIC_API_KEY"
        } else {
            "OPENAI_API_KEY"
        }
    }

    fn masked_key(&self) -> String {
        if self.api_key_visible || self.api_key.is_empty() {
            self.api_key.clone()
        } else if self.api_key.len() <= 8 {
            "*".repeat(self.api_key.len())
        } else {
            format!(
                "{}...{}",
                &self.api_key[..4],
                &self.api_key[self.api_key.len() - 4..]
            )
        }
    }

    fn save(&mut self) {
        let updates: Vec<(&str, String)> = vec![
            (
                "STAGEHAND_LLM_PROVIDER",
                self.provider_name().to_string(),
            ),
            (
                "STAGEHAND_LLM_MODEL",
                self.selected_model().id.to_string(),
            ),
            (self.api_key_var(), self.api_key.clone()),
        ];

        match write_env(&self.env_path, &updates) {
            Ok(_) => {
                self.saved = true;
                self.status_msg = Some(
                    "Saved!  Restart ai-vision for changes to take effect.".to_string(),
                );
            }
            Err(e) => {
                self.status_msg = Some(format!("Error saving: {}", e));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// .env I/O
// ---------------------------------------------------------------------------

fn load_env(path: &PathBuf) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(content) = fs::read_to_string(path) else {
        return map;
    };
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(
                k.trim().to_string(),
                v.trim().trim_matches('"').to_string(),
            );
        }
    }
    map
}

/// Rewrite .env in-place: update matching keys, append new ones, preserve comments.
fn write_env(path: &PathBuf, updates: &[(&str, String)]) -> io::Result<()> {
    let content = fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut written: Vec<bool> = vec![false; updates.len()];

    for line in lines.iter_mut() {
        let trimmed = line.trim_start_matches('#').trim().to_string();
        for (i, (key, value)) in updates.iter().enumerate() {
            if trimmed.starts_with(&format!("{}=", key)) {
                *line = format!("{}={}", key, value);
                written[i] = true;
            }
        }
    }

    // Append any keys that weren't already in the file
    for (i, (key, value)) in updates.iter().enumerate() {
        if !written[i] {
            lines.push(format!("{}={}", key, value));
        }
    }

    fs::write(path, lines.join("\n") + "\n")
}

fn find_env_path() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_default();
    let mut dir: &std::path::Path = cwd.as_path();
    loop {
        let candidate = dir.join(".env");
        if candidate.exists() {
            return candidate;
        }
        match dir.parent() {
            Some(p) if p != dir => dir = p,
            _ => break,
        }
    }
    cwd.join(".env")
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let vert = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vert[1])[1]
}

fn ui(frame: &mut Frame, app: &App) {
    let area = frame.area();

    frame.render_widget(
        Block::default().style(Style::default().bg(Color::Black)),
        area,
    );

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(area);

    // Title bar
    frame.render_widget(
        Paragraph::new(" ai-vision  ·  LLM Configuration ")
            .style(
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )
            .alignment(Alignment::Center)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Cyan)),
            ),
        chunks[0],
    );

    // Content
    match app.screen {
        Screen::Provider => render_provider(frame, app, chunks[1]),
        Screen::Model => render_model(frame, app, chunks[1]),
        Screen::ApiKey => render_api_key(frame, app, chunks[1]),
        Screen::Confirm => render_confirm(frame, app, chunks[1]),
    }

    // Help / status bar
    let (help_text, help_style) = if let Some(msg) = &app.status_msg {
        let color = if app.saved { Color::Green } else { Color::Red };
        (msg.clone(), Style::default().fg(color).add_modifier(Modifier::BOLD))
    } else {
        let text = match app.screen {
            Screen::Provider => " ↑↓  Navigate    Enter  Select    q  Quit ".to_string(),
            Screen::Model => " ↑↓  Navigate    Enter  Select    ←/Bksp  Back    q  Quit ".to_string(),
            Screen::ApiKey => " Type key    Ctrl+U  Clear field    Tab  Toggle visibility    Enter  Continue    ←  Back    q  Quit ".to_string(),
            Screen::Confirm => " Enter  Save & Exit    b  Back    q  Quit ".to_string(),
        };
        (text, Style::default().fg(Color::DarkGray))
    };

    frame.render_widget(
        Paragraph::new(help_text)
            .style(help_style)
            .alignment(Alignment::Center)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::DarkGray)),
            ),
        chunks[2],
    );
}

fn render_provider(frame: &mut Frame, app: &App, area: Rect) {
    let items: Vec<ListItem> = PROVIDERS
        .iter()
        .enumerate()
        .map(|(i, &name)| {
            let label = if i == 0 {
                "  Anthropic  (claude-*)"
            } else {
                "  OpenAI     (gpt-* / o*)"
            };
            let style = if i == app.provider_idx {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };
            let _ = name;
            ListItem::new(label).style(style)
        })
        .collect();

    let mut state = ListState::default();
    state.select(Some(app.provider_idx));

    let inner = centered_rect(54, 50, area);
    frame.render_widget(Clear, inner);
    frame.render_stateful_widget(
        List::new(items)
            .block(
                Block::default()
                    .title(" 1/3  Select Provider ")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Yellow)),
            )
            .highlight_style(Style::default().bg(Color::DarkGray)),
        inner,
        &mut state,
    );
}

fn render_model(frame: &mut Frame, app: &App, area: Rect) {
    let models = app.models();
    let items: Vec<ListItem> = models
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let style = if i == app.model_idx {
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };
            ListItem::new(format!("  {:12}  {}", m.display, m.tier)).style(style)
        })
        .collect();

    let mut state = ListState::default();
    state.select(Some(app.model_idx));

    let inner = centered_rect(68, 60, area);
    frame.render_widget(Clear, inner);
    frame.render_stateful_widget(
        List::new(items)
            .block(
                Block::default()
                    .title(format!(" 2/3  Select Model  [{}] ", app.provider_name()))
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Green)),
            )
            .highlight_style(Style::default().bg(Color::DarkGray)),
        inner,
        &mut state,
    );
}

fn render_api_key(frame: &mut Frame, app: &App, area: Rect) {
    let inner = centered_rect(68, 30, area);
    frame.render_widget(Clear, inner);

    let var_name = app.api_key_var();
    let display = app.masked_key();
    let (badge, badge_color) = if app.api_key.is_empty() {
        ("[not set]", Color::Red)
    } else {
        ("[set]", Color::Green)
    };

    frame.render_widget(
        Paragraph::new(format!(" {}_", display))
            .style(Style::default().fg(Color::White))
            .block(
                Block::default()
                    .title(format!(" 3/3  {}  {} ", var_name, badge))
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Magenta))
                    .title_style(
                        Style::default()
                            .fg(badge_color)
                            .add_modifier(Modifier::BOLD),
                    ),
            ),
        inner,
    );
}

fn render_confirm(frame: &mut Frame, app: &App, area: Rect) {
    let inner = centered_rect(62, 65, area);
    frame.render_widget(Clear, inner);

    let model = app.selected_model();
    let key_len = app.api_key.len();
    let key_display = if app.api_key.is_empty() {
        Span::styled("not set  ⚠", Style::default().fg(Color::Red))
    } else {
        let preview = format!(
            "{}...{}  ✓",
            &app.api_key[..4.min(key_len)],
            if key_len > 4 { &app.api_key[key_len - 4..] } else { "" }
        );
        Span::styled(preview, Style::default().fg(Color::Green))
    };

    let env_path_str = app.env_path.display().to_string();

    let text = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("  Provider   ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                app.provider_name(),
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled("  Model      ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                model.id,
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled("  Tier       ", Style::default().fg(Color::DarkGray)),
            Span::styled(model.tier, Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  API Key    ", Style::default().fg(Color::DarkGray)),
            key_display,
        ]),
        Line::from(vec![
            Span::styled("  Writes to  ", Style::default().fg(Color::DarkGray)),
            Span::styled(env_path_str, Style::default().fg(Color::DarkGray)),
        ]),
        Line::from(""),
        Line::from(vec![Span::styled(
            "  Press Enter to save  ·  b to go back",
            Style::default().fg(Color::DarkGray),
        )]),
    ];

    frame.render_widget(
        Paragraph::new(text)
            .block(
                Block::default()
                    .title(" Confirm ")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Cyan)),
            )
            .wrap(Wrap { trim: false }),
        inner,
    );
}

// ---------------------------------------------------------------------------
// Event loop
// ---------------------------------------------------------------------------

fn run_app(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
) -> io::Result<()> {
    loop {
        terminal.draw(|f| ui(f, app))?;

        // Block on first event, then drain any additional queued events before
        // redrawing — this prevents paste characters being lost during draw cycles.
        let first = event::read()?;
        let mut events = vec![first];
        while event::poll(std::time::Duration::from_millis(0))? {
            events.push(event::read()?);
        }

        for evt in events {
        match evt {
            // Paste support — strips surrounding whitespace/newlines
            Event::Paste(s) => {
                if app.screen == Screen::ApiKey {
                    app.api_key.push_str(s.trim());
                }
            }

            Event::Key(key) => {
                if key.kind != KeyEventKind::Press {
                    continue;
                }

                // Global quit — disabled on ApiKey screen so 'q' can be part of the key
                if app.screen != Screen::ApiKey
                    && matches!(key.code, KeyCode::Char('q') | KeyCode::Esc)
                {
                    return Ok(());
                }

                match app.screen {
                    Screen::Provider => match key.code {
                        KeyCode::Up => {
                            if app.provider_idx > 0 {
                                app.provider_idx -= 1;
                            }
                        }
                        KeyCode::Down => {
                            if app.provider_idx < PROVIDERS.len() - 1 {
                                app.provider_idx += 1;
                            }
                        }
                        KeyCode::Enter => {
                            app.model_idx = 1;
                            app.api_key.clear();
                            app.screen = Screen::Model;
                        }
                        _ => {}
                    },

                    Screen::Model => match key.code {
                        KeyCode::Up => {
                            if app.model_idx > 0 {
                                app.model_idx -= 1;
                            }
                        }
                        KeyCode::Down => {
                            let max = app.models().len() - 1;
                            if app.model_idx < max {
                                app.model_idx += 1;
                            }
                        }
                        KeyCode::Enter => {
                            app.screen = Screen::ApiKey;
                        }
                        KeyCode::Backspace | KeyCode::Left => {
                            app.screen = Screen::Provider;
                        }
                        _ => {}
                    },

                    Screen::ApiKey => match key.code {
                        KeyCode::Enter => {
                            app.screen = Screen::Confirm;
                        }
                        KeyCode::Tab => {
                            app.api_key_visible = !app.api_key_visible;
                        }
                        KeyCode::Backspace => {
                            app.api_key.pop();
                        }
                        KeyCode::Delete => {
                            app.api_key.clear();
                        }
                        KeyCode::Char('u')
                            if key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            app.api_key.clear();
                        }
                        KeyCode::Left => {
                            app.screen = Screen::Model;
                        }
                        KeyCode::Char(c) => {
                            app.api_key.push(c);
                        }
                        _ => {}
                    },

                    Screen::Confirm => match key.code {
                        KeyCode::Enter => {
                            app.save();
                            terminal.draw(|f| ui(f, app))?;
                            event::read()?;
                            return Ok(());
                        }
                        KeyCode::Char('b') => {
                            app.screen = Screen::ApiKey;
                        }
                        _ => {}
                    },
                }
            }

            _ => {}
        }
        } // end for evt
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() -> io::Result<()> {
    let env_path = find_env_path();
    let mut app = App::new(env_path);

    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen, EnableBracketedPaste)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_app(&mut terminal, &mut app);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableBracketedPaste)?;

    result
}
