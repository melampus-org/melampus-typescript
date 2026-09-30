"""Run under the pinned Python reference environment, not a TS runtime dependency."""
import sys
from pathlib import Path

from melampus.watcher import Session, decode

findings = []
session = Session(findings.append)
for path in sorted(Path(sys.argv[1]).glob('*.protobuf')):
    session.accept(decode(path.read_bytes()))
assert session.counts['passed'] == 1
assert session.counts['failed'] == 1
assert session.exit_code == 1
assert len(findings) == 1
assert findings[0].function == 'interop:price'
print('Python reference accepted TypeScript OTel exporter evidence:', session.summary())
