# Como lançar uma versão nova do Toyser

O Toyser confere uma vez por dia a página de Releases do GitHub
(`ToyDeving/Marble2`). Se a versão do Release mais recente for maior que a
versão instalada, aparece uma barra no navegador: "Toyser X is available",
com **Update now** (baixa e abre o instalador), **Later** e **Skip this version**.

Código: `browser/components/toyser-update/ToyserUpdate.sys.mjs`.
Configurações (about:config): `toyser.version`, `toyser.update.repository`,
`toyser.update.enabled`.

## Passo a passo

1. **Aumente o número da versão** em `browser/app/profile/firefox.js`:
   ```
   pref("toyser.version", "1.0.0");   ->   pref("toyser.version", "1.1.0");
   ```
   Use sempre 3 números (maior.menor.correção). A versão nova tem que ser
   maior que a anterior, senão ninguém recebe o aviso.

2. **Compile e gere o instalador** (terminal do MozillaBuild:
   PowerShell -> `C:\mozilla-build\start-shell.bat`):
   ```
   cd /c/Users/Toya/Marble2
   ./mach build
   ./mach package
   ./mach repackage installer -o obj-x86_64-pc-windows-msvc/dist/Toyser-Instalador.exe --package-name marble --package obj-x86_64-pc-windows-msvc/dist/marble-153.3.0.en-US.win64.zip --tag browser/installer/windows/app.tag --setupexe obj-x86_64-pc-windows-msvc/browser/installer/windows/instgen/setup.exe --sfx-stub other-licenses/7zstub/firefox/7zSD.Win32.sfx --use-upx
   ```

3. **Envie o código** pro GitHub (`git commit` e `git push`).

4. **Crie o Release no GitHub**:
   - Abra https://github.com/ToyDeving/Marble2/releases/new
   - Em **Choose a tag**, digite a versão com um `v` na frente, igual à do
     passo 1 (ex.: `v1.1.0`) e clique em **Create new tag**.
   - Dê um título (ex.: `Toyser 1.1.0`) e escreva o que mudou.
   - Arraste o arquivo
     `obj-x86_64-pc-windows-msvc/dist/Toyser-Instalador.exe` pra área de
     anexos. O nome precisa terminar em `.exe` (de preferência com
     "Instalador" no nome).
   - Clique em **Publish release**. Não marque "pre-release" (o GitHub não
     considera pre-releases como "latest").

Pronto: em até um dia (ou ao abrir o navegador, 30 segundos depois do início,
se a última checagem tiver sido há mais de 24 h), quem tiver uma versão
antiga vê o aviso.

## Testar o aviso no seu próprio Toyser

Em about:config, coloque `toyser.version` como `0.0.1` e `toyser.update.lastCheck`
como `0`, e reinicie o Toyser. 30 segundos depois deve aparecer a barra (se já
existir um Release publicado). Depois, volte `toyser.version` ao normal
(botão de "reset" na linha).
