#!/usr/bin/env python3
"""Create reviewed recovery metadata from raw committed Git bytes, never a checkout archive."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
EXTRAS = ('.gitattributes', 'tools/package-site.cjs', 'tools/package-site-verify.cjs',
          'tools/deploy-ip-site.sh', 'tools/deploy-world-server.sh', 'tools/world-server.py')


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def generate(commit, node, destination):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Supply one full reviewed commit.')
    if git('rev-parse', commit).decode().strip() != commit:
        raise ValueError('Commit does not resolve exactly.')
    destination = destination.resolve()
    if not destination.is_relative_to(ROOT / 'deployment-artifacts'):
        raise ValueError('Canonical evidence must stay in deployment-artifacts.')
    destination.mkdir(parents=True, exist_ok=False)
    collector = ROOT / 'tools/package-site.cjs'
    script = "const p=require(process.argv[1]); console.log(JSON.stringify([...p.collectRelease(process.argv[2]).files.keys()]));"
    paths = json.loads(subprocess.check_output([node, '-e', script, str(collector), str(ROOT)]))
    with tempfile.TemporaryDirectory(prefix='raw-', dir=destination) as temporary:
        source = Path(temporary)
        for path in set(paths) | set(EXTRAS):
            target = source / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(git('cat-file', 'blob', commit + ':' + path))
        # Re-run that commit's own collector against its raw source graph.
        paths = json.loads(subprocess.check_output([node, '-e', script, str(source / 'tools/package-site.cjs'), str(source)]))
        runtime = [{'path': path, 'bytes': (source / path).stat().st_size,
                    'sha256': digest((source / path).read_bytes())} for path in paths]
        manifest = {'version': 1, 'fileCount': len(runtime),
                    'totalBytes': sum(item['bytes'] for item in runtime), 'files': runtime}
        fingerprint = digest(json.dumps(manifest, separators=(',', ':'), ensure_ascii=False).encode())
        files = []
        for path in sorted(set(paths) | set(EXTRAS)):
            info = git('ls-tree', commit, '--', path).decode().strip().split()
            if len(info) < 4 or info[1] != 'blob':
                raise ValueError('Expected a committed regular file: ' + path)
            raw = (source / path).read_bytes()
            files.append({'path': path, 'bytes': len(raw), 'sha256': digest(raw), 'mode': info[0], 'oid': info[2]})
        tree = git('rev-parse', commit + '^{tree}').decode().strip()
        trees = {tree}
        for line in git('ls-tree', '-rt', commit).decode().splitlines():
            fields = line.split()
            if fields[1] == 'tree':
                trees.add(fields[2])
        objects = [{'type': kind, 'oid': oid, 'data': base64.b64encode(git('cat-file', kind, oid)).decode()}
                   for kind, oid in [('commit', commit), *[('tree', oid) for oid in sorted(trees)]]]
        # Twenty tiny illustrations share one API transfer, staying below rate limits.
        inline = [{'path': item['path'], 'data': base64.b64encode((source / item['path']).read_bytes()).decode()}
                  for item in files if item['path'].startswith('assets/sprites/') or item['path'] == 'online-reset.js']
        descriptor = {'version': 1, 'commit': commit, 'tree': tree, 'runtimeFingerprint': fingerprint,
                      'runtime': manifest, 'objects': objects, 'files': files, 'inlineFiles': inline}
        raw = (json.dumps(descriptor, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
        (ROOT / 'tools/deploy-api-release.json').write_bytes(raw)
        (destination / 'static-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        (destination / 'release-proof.json').write_text(json.dumps({
            'commit': commit, 'tree': tree, 'runtimeFingerprint': fingerprint,
            'fileCount': len(runtime), 'totalBytes': manifest['totalBytes'], 'descriptorSha256': digest(raw),
            'scriptHashes': {path: digest((source / path).read_bytes()) for path in EXTRAS if path.endswith('.sh')},
            'backendSha256': digest((source / 'tools/world-server.py').read_bytes()),
            'inlineFiles': len(inline)}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(json.loads((destination / 'release-proof.json').read_text()), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('commit')
    parser.add_argument('--node', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    generate(args.commit, args.node, Path(args.output))
