# Product scope

The authoritative full PRD is sections 1 and 8–13 of PRODUCT_SPECIFICATION.md, version 1.0. SitePulse serves WordPress freelancers, agencies, and maintenance providers. Commercial validation targets in that specification remain hypotheses.

The implemented milestones support account registration/login, password recovery, email verification, organization creation, membership-aware access, workspace pages, and audit events. The connector milestone adds tenant-isolated sites, single-use pairing challenges, revocable site credentials, a single-site WordPress plugin, periodic heartbeats, and independent stale-connection detection. Only verified owners and administrators can manage sites; members have read access.

Heartbeat status represents connector freshness, not website availability. Inventory, external HTTP/SSL monitoring, incidents, alert notifications, and billing remain separate milestones. Live WordPress pairing and real authentication email delivery still require staging acceptance; see CONNECTOR_ACCEPTANCE.md. These implementations do not claim to satisfy the full MVP definition of done or pilot launch criteria.
