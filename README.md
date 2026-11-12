osint# playgta5 Source Code
This code is grabbed from playgta5.com before it got took down. You can run this locally or make it public hehe.
This github page serves as archival for the original V1 port of the game,

# V2 of Grand-V is releasing on a new github page,

https://github.com/SebasKitten/Grand-V

# Credits
Shoutout to Sebas Furbastian on Telegram for scrapping this code. Idk what is his GitHub but here's the Telegram and X.

Telegram: @SebasKitten

X: @Sebas_Kitten

# Link
Telegram: https://t.me/reGRANDTA

Discord: https://discord.gg/hrbcPjjZfj


# Disclaimer
I don't host the `.\mirror` folder since it has copyrighted content from Rockstar Games. Please find the files by yourself.

No copyrighted file is included in this repo. If Rockstar Games or any affiliated group think this repo has copyright infringement things, email me at shadany7824@gmail.com for me to took it down.

And don't email me for asking the mirror folder. I will not reply to the email.

# How to use
1. Download the ZIP or just `git clone` it. It should have all this file and folders.
<p align="center">
  <img src="media/Screenshot 2026-10-07 172103.png" alt="playgta5 SC">
</p>

2. Paste your `.mirror` folder at your desired path. (It should have 19.7 GB of file size. Check the pic below.)
<p align="center">
  <img src="media/Screenshot 2026-10-07 172216.png" alt="Folder Properties">
</p>
<p align="center">
  <img src="media/Screenshot 2026-10-07 172718.png" alt="Folder Properties">
</p>
<p align="center">
  <img src="media/Screenshot 2026-10-07 172758.png" alt="Folder Properties">
</p>

3. Run the `Launch-Local.cmd` and it will automatically open the URL at `http://localhost:8000/`.

4. Voila!

## Local split-ZIP source

On Cloudflare Pages, local ZIP mode is enabled by default. In the **Use your
local ZIP files** panel, enter the localhost directory URLs for part 1 and
parts 2–14. The game will not start until both URLs are saved. **Clear saved
paths** removes them and disables local ZIP mode. Add `?localzip=0` to use the
site's standard ZIP source instead. Each directory
must serve `playgta5-part-01-of-14.zip` or `playgta5-part-02-of-14.zip` through
`playgta5-part-14-of-14.zip`, respectively. The paths are saved in that
browser's local storage.

Run local file servers for those directories, for example:

```sh
python -m http.server 500 --bind 127.0.0.1 --directory /path/to/part-1-folder
python -m http.server 10000 --bind 127.0.0.1 --directory /path/to/parts-2-to-14-folder
```

Keep both source servers running. Start `Launch-Local.cmd` to run the localhost
proxy, enter their base URLs (for example `http://localhost:500/` and
`https://localhost:10000/`), and save. HTTP and HTTPS localhost sources are
accepted; the proxy serves the expected ZIP filename for each part, so source
servers do not need CORS enabled. The proxy must run on the same device as the
browser because its address is `127.0.0.1:8000`; on an iPhone, a proxy running
on a PC is not reachable as `localhost`. Cloudflare Pages preview hostnames
are accepted by the proxy's private-network CORS check.

## iPhone and memory32

The page automatically selects the 32-bit engine and low-memory profile on iPhone, iPad, and browsers without shared memory64 support. To test the same path on desktop, open `/?memory=32`. Add `&low=0` to override the low-memory profile for testing.

The ZIP includes `game-memory32.js` and `game-memory32.wasm` in `mirror/playgta5.com/b/8b0b5899ed/`. Merge the contents of your existing `mirror/playgta5.com/` into that folder tree to add the matching game data, shaders, and worker scripts. Keep both `game-memory32` files together in the build directory.

The included engine was converted with Binaryen 132. It uses 32-bit WebAssembly memory and table addresses and preserves the engine's internal 64-bit data layout. The shared heap starts at 512 MiB and can grow to 2 GiB. In a local startup test it reached about 1.44 GiB before the game requested its asset manifest. The test covered engine initialization and a pthread. Gameplay on an iPhone still needs to be tested with the matching assets.

For an HTTPS deployment, publish `homepage.html` as `/index.html` and `loader.js` as `/b/8b0b5899ed/loader.js`. Serve the engine and game data on that origin with the same isolation headers as `serve_local.py` and use `application/wasm` for the engine binary. Open the HTTPS URL in Safari on your iPhone. The game also needs WebGPU in a worker, OffscreenCanvas, and the matching mirror assets.

# Requirement
Scripts require standard-library Python 3.11 or newer. The bundled Python path
in the commands above is specific to the original PC; the portable ZIP instead
provides `runtime\python.exe` and the double-click launcher.
Completed files and `.part` transfers are retained for resumption. Final checks
cover inventory sizes, runtime hash samples, WASM signature, HTTP isolation,
range reads and both batch formats. Actual gameplay requires separate browser
validation. A public client snapshot is not the site's original development repository.

To resume with the current uncapped settings, append `--workers 32 --rate-mib 0`
to the downloader command. Content lengths from HTTP take precedence over the
source manifest when it is stale; mismatches are recorded explicitly.
