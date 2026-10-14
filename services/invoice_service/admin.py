"""
Managing who may use the API.

    python -m invoice_service.admin add-user alice      # prints alice's token, once
    python -m invoice_service.admin rotate-token alice  # a new token; the old one stops working
    python -m invoice_service.admin disable-user alice
"""

from __future__ import annotations

import argparse
import sys

from .config import load_settings
from .store import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["add-user", "rotate-token", "disable-user"])
    parser.add_argument("name")
    args = parser.parse_args()
    settings = load_settings()
    store = Store(settings.db_path, settings.files_dir)
    if args.action == "add-user":
        token = store.create_user(args.name)
    elif args.action == "rotate-token":
        token = store.rotate_token(args.name)
    else:
        if not store.disable_user(args.name):
            sys.exit(f"No user called {args.name}.")
        print(f"{args.name} can no longer sign in.")
        return
    if token is None:
        sys.exit(f"No user called {args.name}.")
    print(f"Access token for {args.name} (shown once, keep it somewhere safe):\n{token}")


if __name__ == "__main__":
    main()
