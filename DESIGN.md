# Design

## Color

Strategy: Restrained (tinted neutrals + accent ≤10%)

All values in OKLCH.

| Token | Value | Role |
|---|---|---|
| `--primary` | `oklch(0.620 0.120 185)` | Primary brand color. Teal. Buttons, active states, links. |
| `--primary-hover` | `oklch(0.560 0.130 185)` | Darkened primary for hover. |
| `--primary-subtle` | `oklch(0.620 0.120 185 / 0.08)` | Primary tint for selected row backgrounds, focus rings. |
| `--primary-border` | `oklch(0.620 0.120 185 / 0.20)` | Primary-tinted border for hover states. |
| `--accent` | `oklch(0.750 0.160 70)` | Warm amber. Reserved for badges, status, secondary CTA. |
| `--accent-subtle` | `oklch(0.750 0.160 70 / 0.10)` | Accent background tint. |
| `--bg` | `oklch(0.100 0.000 0)` | Body background. Pure near-black, no hue. |
| `--surface` | `oklch(0.145 0.000 0)` | Cards, panels, table headers. |
| `--surface-hover` | `oklch(0.170 0.000 0)` | Hover state for rows/surfaces. |
| `--border` | `oklch(1.000 0.000 0 / 0.08)` | Default border. |
| `--border-hover` | `oklch(1.000 0.000 0 / 0.14)` | Hover border. |
| `--ink` | `oklch(0.940 0.005 185)` | Body text. Faint cool lean toward brand. |
| `--muted` | `oklch(0.600 0.005 185)` | Secondary text. |
| `--faint` | `oklch(0.450 0.003 185)` | Tertiary/disabled text. |
| `--success` | `oklch(0.700 0.150 155)` | Positive values (rent refund amounts). |
| `--error` | `oklch(0.650 0.200 25)` | Error states. |
| `--warning` | `oklch(0.780 0.160 85)` | Warning states. |

## Typography

Single family: Inter (Google Fonts).

| Role | Size | Weight | Tracking |
|---|---|---|---|
| H1 (page heading) | 1.75rem (28px) | 700 | -0.02em |
| H2 (section heading) | 1.125rem (18px) | 700 | normal |
| Body | 1rem (16px) | 400 | normal |
| Body small | 0.9375rem (15px) | 400 | normal |
| Label/Meta | 0.8125rem (13px) | 500–600 | normal |
| Mono (addresses) | 0.8125rem (13px) | 400 | normal |
| Table header | 0.75rem (12px) | 600 | 0.04em, uppercase |
| Footer | 0.75rem (12px) | 400 | normal |

Line length capped at 55ch for body prose.

## Spacing

| Token | Value |
|---|---|
| Page max-width | 720px |
| Page padding (horizontal) | 1.25rem |
| Section gap | 2–3rem |
| Card padding | 1–2.5rem depending on context |

## Radii

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | Tags, small badges |
| `--radius-md` | 10px | Buttons, inputs |
| `--radius-lg` | 14px | Cards, panels |
| `--radius-pill` | 9999px | Status dots, scrollbar |

## Components

### Button (Primary)
- Background: `var(--primary)`
- Text: white
- Border: none
- Radius: `var(--radius-md)`
- Hover: `var(--primary-hover)` + 3px focus ring in `var(--primary-subtle)`
- Disabled: opacity 0.6, cursor wait
- Font: 0.875rem, weight 600

### Button (Secondary)
- Background: `var(--surface)`
- Text: `var(--ink)`
- Border: 1px solid `var(--border)`
- Hover: `var(--surface-hover)`

### Account Row
- Grid: checkbox | address + label | rent refund
- Selected: background `var(--primary-subtle)`
- Hover: background `var(--surface-hover)`
- Separator: 1px border bottom

### Details/Disclosure
- Used for fee transparency section
- Summary styled as semibold 0.875rem
- Content styled as muted body text

## Motion

- Transitions: 150–200ms, ease-out
- Scan progress bar: CSS keyframe slide animation, 1.2s infinite
- No page-load sequences
- `@media (prefers-reduced-motion: reduce)` kills all animation/transition
