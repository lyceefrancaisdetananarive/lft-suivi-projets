"""Sous-ensembles Phosphor (icones utilisees) + CSS compact, pour index.html.
Usage : python3 construire.py <dossier_telechargements> <depot>
Ecrit <depot>/fonts/Phosphor-{Regular,Bold,Light}.woff2 et Spectral-*.woff2,
et imprime le bloc CSS a inserer (sur stdout, dans un fichier passe en 3e arg).
"""
import re, sys, shutil, subprocess, os

dl, depot, sortie_css = sys.argv[1], sys.argv[2], sys.argv[3]
page = open(os.path.join(depot, 'index.html'), encoding='utf-8').read()
noms = sorted(set(re.findall(r'ph-[a-z0-9]+(?:-[a-z0-9]+)*', page))
         - {'ph-bold', 'ph-light', 'ph-fill', 'ph-regular', 'ph-thin', 'ph-duotone'})

POIDS = [  # (classe, fichier css, police source, famille, fichier cible)
    ('ph', 'regular.css', 'Phosphor.woff2', 'Phosphor', 'Phosphor-Regular.woff2'),
    ('ph-bold', 'bold.css', 'Phosphor-Bold.woff2', 'Phosphor-Bold', 'Phosphor-Bold.woff2'),
    ('ph-light', 'light.css', 'Phosphor-Light.woff2', 'Phosphor-Light', 'Phosphor-Light.woff2'),
]
css = ['/* Phosphor Icons 2.1.2 (MIT), reduit aux %d icones de la page : outils/construire-icones.py */' % len(noms)]
for classe, fcss, src, famille, cible in POIDS:
    texte = open(os.path.join(dl, fcss), encoding='utf-8').read()
    codes = {}
    for n in noms:
        m = re.search(r'\.%s\.%s:before\s*\{\s*content:\s*"\\([0-9a-f]+)";' % (re.escape(classe), re.escape(n)), texte)
        if not m:
            raise SystemExit('icone introuvable : %s %s' % (classe, n))
        codes[n] = m.group(1)
    sortie = os.path.join(depot, 'fonts', cible)
    subprocess.run([sys.executable, '-m', 'fontTools.subset', os.path.join(dl, src),
                    '--unicodes=' + ','.join('U+' + c for c in sorted(set(codes.values()))),
                    '--flavor=woff2', '--layout-features=', '--no-hinting',
                    '--output-file=' + sortie], check=True)
    css.append("@font-face{font-family:'%s';src:url('fonts/%s') format('woff2');font-weight:normal;font-style:normal;font-display:block}" % (famille, cible))
    css.append(".%s{font-family:'%s'!important;speak:never;font-style:normal;font-weight:normal;font-variant:normal;text-transform:none;line-height:1;letter-spacing:0;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}" % (classe, famille))
    css.append(''.join('.%s.%s:before{content:"\\%s"}' % (classe, n, codes[n]) for n in noms))

for nom in ('Spectral-Regular', 'Spectral-Italic', 'Spectral-Bold', 'Spectral-ExtraBold'):
    shutil.copyfile(os.path.join(dl, nom + '.woff2'), os.path.join(depot, 'fonts', nom + '.woff2'))
css.append('/* Spectral (SIL OFL 1.1), sous-ensemble latin de Google Fonts, heberge ici */')
for nom, poids, style in (('Spectral-Regular', 400, 'normal'), ('Spectral-Italic', 400, 'italic'),
                          ('Spectral-Bold', 700, 'normal'), ('Spectral-ExtraBold', 800, 'normal')):
    css.append("@font-face{font-family:'Spectral';src:url('fonts/%s.woff2') format('woff2');font-weight:%d;font-style:%s;font-display:swap}" % (nom, poids, style))

open(sortie_css, 'w', encoding='utf-8').write('\n'.join(css) + '\n')
print('%d icones, CSS %d octets' % (len(noms), len('\n'.join(css))))
