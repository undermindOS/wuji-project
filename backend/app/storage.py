import hashlib
import os
import re
from pathlib import Path
from uuid import uuid4

from .schemas import OriginalFile


class IntegrityError(Exception):
    pass


class FileStore:
    def __init__(self, root: Path):
        self.root = root / 'objects'

    def path(self, sha256: str):
        if not re.fullmatch(r'[a-f0-9]{64}', sha256):
            raise IntegrityError('Invalid object hash')
        return self.root / sha256[:2] / sha256

    def save(self, filename: str, kind: str, content: bytes):
        digest = hashlib.sha256(content).hexdigest()
        path = self.path(digest)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = path.parent / f'.{uuid4()}.tmp'
        try:
            with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
                output.write(content)
            temporary.chmod(0o400)
            try:
                os.link(temporary, path)
            except FileExistsError:
                self.read(digest)
        finally:
            temporary.unlink(missing_ok=True)
        name = filename.replace('\\', '/').split('/')[-1]
        if not name or len(name) > 255 or any(ord(c) < 32 for c in name):
            raise ValueError('Filename must be a basename of at most 255 characters without control characters')
        return OriginalFile(id=str(uuid4()), filename=name, kind=kind, sha256=digest, size=len(content))

    def read(self, digest: str):
        try:
            content = self.path(digest).read_bytes()
        except FileNotFoundError as error:
            raise IntegrityError('Original file is missing') from error
        if hashlib.sha256(content).hexdigest() != digest:
            raise IntegrityError('Original file hash changed')
        return content
