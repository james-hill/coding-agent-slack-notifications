Enable notification sounds by setting `sound: true` in the notify config file. Also set `enabled: true` if it is currently `false`, since wanting sound implies wanting notifications.

The config file path is: `$HOME/.notify.yaml` (use the HOME environment variable to resolve the absolute path).

Read the file, change the `sound:` line from `false` to `true`, and write it back. If there is no sound line, add `sound: true` after the comment header. Also change `enabled: false` to `enabled: true` if present.
