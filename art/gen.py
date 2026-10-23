"""Generate the SVG art for firebase-auth-tanstack-start. Run: python3 gen.py, then render.sh <this dir>."""

from pathlib import Path

HERE = Path(__file__).parent
SANS = "Inter, -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif"
MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"

# Accent: teal (siblings use emerald, sky, violet, pink). Solid fills only, no translucent warm colours.
DEFS = """  <defs>
    <linearGradient id="ibg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0F172A"/>
      <stop offset="1" stop-color="#0B1220"/>
    </linearGradient>
    <linearGradient id="acc" gradientUnits="userSpaceOnUse" x1="90" y1="100" x2="380" y2="400">
      <stop offset="0" stop-color="#5EEAD4"/>
      <stop offset="1" stop-color="#14B8A6"/>
    </linearGradient>
    <mask id="bite">
      <rect width="512" height="512" fill="#fff"/>
      <circle cx="362" cy="118" r="62" fill="#000"/>
      <circle cx="402" cy="196" r="30" fill="#000"/>
    </mask>
  </defs>
"""

# Icon body on a 512 canvas: a session cookie with a keyhole (the httpOnly cookie the server reads during SSR),
# and a shield with a check where the token is verified against Google's public keys.
ICON_BODY = """  <!-- session cookie -->
  <circle cx="236" cy="252" r="160" fill="url(#acc)" mask="url(#bite)"/>
  <ellipse cx="160" cy="176" rx="17" ry="13" fill="#0F766E"/>
  <ellipse cx="300" cy="340" rx="15" ry="12" fill="#0F766E"/>
  <ellipse cx="146" cy="318" rx="13" ry="10" fill="#0F766E"/>
  <ellipse cx="318" cy="232" rx="11" ry="9" fill="#0F766E"/>
  <!-- keyhole -->
  <circle cx="230" cy="232" r="36" fill="#0B1220"/>
  <path d="M212 252 L248 252 L262 318 L198 318 Z" fill="#0B1220"/>
  <!-- verified -->
  <path d="M398 300 L462 324 V374 C462 416 434 444 398 462 C362 444 334 416 334 374 V324 Z" fill="#F8FAFC" stroke="#0B1220" stroke-width="12" stroke-linejoin="round"/>
  <path d="M370 380 L390 400 L426 360" fill="none" stroke="#0D9488" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
"""


def icon(framed: bool) -> str:
    bg = (
        '<rect x="3" y="3" width="506" height="506" rx="110" fill="url(#ibg)" stroke="#24314D" stroke-width="6"/>'
        if framed
        else '<rect width="512" height="512" rx="112" fill="url(#ibg)"/>'
    )
    return f"  {bg}\n{ICON_BODY}"


def write(name: str, svg: str) -> None:
    (HERE / name).write_text(svg)


write(
    "icon.svg",
    f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">\n{DEFS}{icon(True)}</svg>\n',
)


def banner(dark: bool) -> str:
    bg, dot, title, sub, accent, chip_bg, chip_stroke, chip_text = (
        ("#0B1220", "#1A2540", "#F8FAFC", "#CBD5E1", "#2DD4BF", "#111C33", "#1E2A44", "#CBD5E1")
        if dark
        else ("#F8FAFC", "#E2E8F0", "#0F172A", "#334155", "#0D9488", "#FFFFFF", "#E2E8F0", "#334155")
    )
    chips = [
        (292, 196, "for TanStack Start", accent),
        (500, 250, "httpOnly session cookies", chip_text),
        (762, 196, "context.user in SSR", chip_text),
    ]
    chip_svg = "\n".join(
        f'    <rect x="{x}" y="204" width="{w}" height="36" rx="18" fill="{chip_bg}" stroke="{chip_stroke}"/>'
        f'<text x="{x + w / 2:g}" y="228" text-anchor="middle" fill="{c}">{t}</text>'
        for x, w, t, c in chips
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300">
{DEFS}  <defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="{dot}"/></pattern></defs>
  <rect width="1200" height="300" fill="{bg}"/>
  <rect x="980" width="220" height="300" fill="url(#dots)"/>
  <g transform="translate(56 50) scale(0.390625)">
{icon(dark)}  </g>
  <text x="290" y="122" font-family="{SANS}" font-size="50" font-weight="800" fill="{title}" letter-spacing="-1.5">firebase-auth-tanstack-start</text>
  <text x="292" y="170" font-family="{SANS}" font-size="24" font-weight="500" fill="{sub}">Firebase Authentication for <tspan fill="{accent}" font-weight="600">TanStack Start</tspan>, verified on the server</text>
  <g font-family="{SANS}" font-size="16" font-weight="600">
{chip_svg}
  </g>
  <text x="1170" y="280" text-anchor="end" font-family="{SANS}" font-size="13" font-weight="500" fill="#64748B">Community package. Not affiliated with or endorsed by Google or Firebase.</text>
</svg>
"""


write("banner-dark.svg", banner(True))
write("banner-light.svg", banner(False))

KW = "#C4B5FD"
FN = "#2DD4BF"
STR = "#7DD3FC"
CMT = "#64748B"
code = [
    (112, 330, f'<tspan fill="{KW}">export const</tspan> getProfile = <tspan fill="{FN}">createServerFn</tspan>()'),
    (137, 362, f'.<tspan fill="{FN}">handler</tspan>(<tspan fill="{KW}">async</tspan> ({{ context }}) =&gt; {{'),
    (162, 394, f'<tspan fill="{KW}">const</tspan> user = auth.<tspan fill="{FN}">requireUser</tspan>(context) <tspan dx="12" fill="{CMT}">// 401 when signed out</tspan>'),
    (162, 426, f'<tspan fill="{KW}">return</tspan> {{ uid: user.uid, role: user.claims.role }}'),
    (137, 458, "})"),
    (112, 490, f'<tspan fill="{CMT}">// session cookie read during SSR: httpOnly, Secure, SameSite=Lax</tspan>'),
]
code_svg = "\n".join(f'    <text x="{x}" y="{y}">{t}</text>' for x, y, t in code)

write(
    "social-preview.svg",
    f"""<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
{DEFS}  <defs><pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#1A2540"/></pattern></defs>
  <rect width="1280" height="640" fill="#0B1220"/>
  <rect width="1280" height="640" fill="url(#dots)"/>
  <g transform="translate(80 64) scale(0.3125)">
{icon(True)}  </g>
  <text x="270" y="132" font-family="{SANS}" font-size="56" font-weight="800" fill="#F8FAFC" letter-spacing="-1.8">firebase-auth-tanstack-start</text>
  <text x="272" y="186" font-family="{SANS}" font-size="27" font-weight="500" fill="#CBD5E1">Firebase Authentication for <tspan fill="#2DD4BF" font-weight="600">TanStack Start</tspan>, verified on the server</text>
  <rect x="80" y="252" width="1120" height="282" rx="20" fill="#0F172A" stroke="#1E2A44" stroke-width="2"/>
  <circle cx="112" cy="282" r="7" fill="#334155"/><circle cx="136" cy="282" r="7" fill="#334155"/><circle cx="160" cy="282" r="7" fill="#334155"/>
  <g font-family="{MONO}" font-size="21" fill="#E2E8F0" xml:space="preserve">
{code_svg}
  </g>
  <g font-family="{SANS}" font-size="20" font-weight="600">
    <text x="80" y="590" fill="#2DD4BF">npm i @amjadiqbal/firebase-auth-tanstack-start</text>
    <text x="1200" y="590" text-anchor="end" fill="#94A3B8">not affiliated with Google or Firebase</text>
  </g>
</svg>
""",
)
