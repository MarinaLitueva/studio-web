# space-mfe

The editor screen: a frame package (ADR-0021) at the project level,
`placement: hidden`, `presentation.route: '/space'`. The shell mounts it when
the address names `screen=space` — opening an artifact is a navigation (#320).

The frame loads the address in `…space.mfe.frame_url.v1~`: the project's Theia
session, which the shell reuses or launches when the editor opens and publishes
once it answers (#322). The artifact reaches the frame in #323; the frame never
reads the portal's address.
