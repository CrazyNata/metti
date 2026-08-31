# Android release checklist

The Play release is built as an Android App Bundle (`.aab`). The repository never contains the upload keystore or its password.

## Local signing

1. Create an upload keystore outside Git, for example at `.tools/metti-upload-key.jks`.
2. Copy `android/keystore.properties.example` to `android/keystore.properties`.
3. Put the keystore path, password, and alias into the copied file.
4. Build with:

```powershell
$env:JAVA_HOME = (Resolve-Path '.tools/jdk17/jdk-17.0.20.1+1').Path
& 'C:\Users\natas\.gradle\wrapper\dists\gradle-8.13-bin\5xuhj0ry160q40clulazy9h7d\gradle-8.13\bin\gradle.bat' --no-daemon --offline -p android bundleRelease
```

The signed bundle is written to `android/app/build/outputs/bundle/release/app-release.aab`.

## Google Play setup

- Enrol the app in Play App Signing and upload the signed bundle.
- Keep a secure backup of the upload keystore and password. Every future update must use the same upload key (or a key reset initiated in Play Console).
- Add the upload-key SHA-1/SHA-256 fingerprints to the Android OAuth client in Google Cloud. After the first Play upload, also add the Play app-signing certificate fingerprints shown in Play Console so Google sign-in works for installed builds.
- Increase `versionCode` for every subsequent upload.

The public legal pages are deployed by the GitHub Pages workflow from `mobile/`. After Pages is enabled for the repository, use:

- `https://crazynata.github.io/metti/privacy.html`
- `https://crazynata.github.io/metti/account-deletion.html`

Add the account-deletion URL to Supabase Auth → URL Configuration → Redirect URLs so Google users can complete the web deletion flow. The in-app profile flow works with both password and Google sessions.
