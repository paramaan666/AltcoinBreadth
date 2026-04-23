from __future__ import annotations

import argparse
import json
from pathlib import Path

from livealt.bootstrap import bootstrap_from_local_seed
from livealt.config import ensure_directories, load_config
from livealt.daily_update import run_pipeline, validate_existing_outputs
from livealt.logging_utils import configure_logging
from livealt.outputs import sync_site_data


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LiveALT Binance breadth pipeline.")
    parser.add_argument("--config", default="config/settings.yaml", help="Path to YAML config.")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run the full daily pipeline.")
    run_parser.add_argument(
        "--bootstrap-source",
        default=None,
        help="Optional path to local 1m parquet seed used when the store is empty.",
    )

    bootstrap_parser = subparsers.add_parser("bootstrap-local", help="Bootstrap daily data from local 1m parquet.")
    bootstrap_parser.add_argument("--source-root", required=True, help="Directory with symbol 1m parquet folders.")

    subparsers.add_parser("validate", help="Validate previously generated outputs.")
    subparsers.add_parser("sync-site-data", help="Copy JSON outputs into site/public/data.")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    config = load_config(args.config)
    ensure_directories(config)
    logger = configure_logging(config.paths.logs_dir, verbose=args.verbose)

    if args.command == "run":
        summary = run_pipeline(
            config=config,
            logger=logger,
            bootstrap_source=Path(args.bootstrap_source) if args.bootstrap_source else None,
        )
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if args.command == "bootstrap-local":
        summary = bootstrap_from_local_seed(config, Path(args.source_root), logger)
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    if args.command == "validate":
        report = validate_existing_outputs(config)
        print(json.dumps(report, indent=2, sort_keys=True))
        return

    if args.command == "sync-site-data":
        sync_site_data(config)
        print(json.dumps({"synced": True}, indent=2))
        return

    parser.error(f"Unknown command {args.command!r}")


if __name__ == "__main__":
    main()
