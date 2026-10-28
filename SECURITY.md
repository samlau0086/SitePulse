# Security

WordPress security visibility is a bounded, read-only assessment, not antivirus certification. Source contents remain on WordPress; only versions, selected environment flags and relative-path rule matches are sent. Public advisory matching has explicit partial/unknown coverage. See [scope and operational limitations](docs/SECURITY_INVENTORY.md).

Report a suspected vulnerability privately to the repository owner using a private security advisory if enabled. Do not post credentials, tenant data, or exploit details in public issues. There is no published security contact or response SLA yet; establish one before pilot launch.

Never commit secrets. Rotate any exposed secret immediately, invalidate affected sessions, inspect audit events, and record the incident privately. Removing a secret from the current file does not remove it from Git history.

See [docs/SECURITY.md](docs/SECURITY.md) for the implemented controls and remaining launch requirements.
