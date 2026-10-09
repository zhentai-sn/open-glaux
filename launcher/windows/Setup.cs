using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class GlauxSetup
{
    [STAThread]
    private static int Main()
    {
        // Keep bootstrap files on the executable's drive; C: may already be nearly full.
        string work = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),
            ".glaux-setup-" + Guid.NewGuid().ToString("N"));
        try
        {
            try { Directory.CreateDirectory(work); }
            catch { work = Path.Combine(Path.GetTempPath(), "glaux-setup-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(work); }
            foreach (string name in new[] { "desktop.ps1", "install.ps1", "install-desktop.ps1" })
            {
                using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("Glaux." + name))
                using (FileStream target = File.Create(Path.Combine(work, name)))
                    source.CopyTo(target);
            }
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            var info = new ProcessStartInfo(shell,
                "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + Path.Combine(work, "desktop.ps1") +
                "\" -Mode Install -InstallerScript \"" + Path.Combine(work, "install.ps1") + "\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            using (Process child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Glaux Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally { try { Directory.Delete(work, true); } catch { } }
    }
}
