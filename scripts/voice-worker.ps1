param([switch]$Probe, [string]$AudioFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
function Send-TaskVoiceEvent($taskValue) { [Console]::WriteLine(($taskValue | ConvertTo-Json -Compress -Depth 4)) }
try {
    Add-Type -AssemblyName System.Speech
    Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.Speech.Recognition;
using System.Threading;
public sealed class LocalVoiceSession : IDisposable {
    public readonly ConcurrentQueue<string> Words = new ConcurrentQueue<string>();
    public volatile bool Finished;
    public volatile bool StopRequested;
    public string Failure;
    public int Rejected;
    public int AudioLevel;
    public int PeakAudioLevel;
    private SpeechRecognitionEngine engine;
    public LocalVoiceSession() {
        engine = new SpeechRecognitionEngine(CultureInfo.GetCultureInfo("zh-CN"));
        engine.LoadGrammar(new DictationGrammar());
        engine.InitialSilenceTimeout = TimeSpan.FromSeconds(15);
        engine.BabbleTimeout = TimeSpan.FromSeconds(15);
        engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(700);
        engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1000);
        engine.SpeechRecognized += (s,e) => { if(e.Result != null && !String.IsNullOrWhiteSpace(e.Result.Text)) Words.Enqueue(e.Result.Text); };
        engine.SpeechRecognitionRejected += (s,e) => Interlocked.Increment(ref Rejected);
        engine.AudioLevelUpdated += (s,e) => { AudioLevel=e.AudioLevel; if(e.AudioLevel>PeakAudioLevel) PeakAudioLevel=e.AudioLevel; };
        engine.RecognizeCompleted += (s,e) => { if(e.Error != null) Failure=e.Error.Message; Finished=true; };
    }
    public void Start(string audioFile) {
        if(String.IsNullOrEmpty(audioFile)) engine.SetInputToDefaultAudioDevice();
        else engine.SetInputToWaveFile(audioFile);
        engine.RecognizeAsync(RecognizeMode.Multiple);
        var stopper = new Thread(() => { try { Console.ReadLine(); StopRequested=true; } catch {} });
        stopper.IsBackground=true;
        stopper.Start();
    }
    public string Pop() { string word; return Words.TryDequeue(out word) ? word : null; }
    public void Stop() { engine.RecognizeAsyncStop(); }
    public void Dispose() { engine.Dispose(); }
}
'@
    $taskVoice = [LocalVoiceSession]::new()
    if ($Probe) {
        Send-TaskVoiceEvent @{type='ready'; language='zh-CN'}
        $taskVoice.Dispose()
        exit 0
    }
    $taskVoice.Start($AudioFile)
    Send-TaskVoiceEvent @{type='listening'}
    $taskClock = [System.Diagnostics.Stopwatch]::StartNew()
    $taskStopping = $false
    $taskLastAudioReport = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not $taskVoice.Finished) {
        while ($null -ne ($taskWord = $taskVoice.Pop())) { Send-TaskVoiceEvent @{type='text'; text=$taskWord} }
        if ($taskLastAudioReport.ElapsedMilliseconds -ge 500) {
            Send-TaskVoiceEvent @{type='audiolevel'; level=$taskVoice.AudioLevel; peak=$taskVoice.PeakAudioLevel}
            $taskLastAudioReport.Restart()
        }
        if (-not $taskStopping -and ($taskVoice.StopRequested -or $taskClock.Elapsed.TotalSeconds -ge 60)) {
            $taskVoice.Stop()
            $taskStopping = $true
        }
        if ($taskStopping -and $taskClock.Elapsed.TotalSeconds -ge 65) { break }
        Start-Sleep -Milliseconds 100
    }
    while ($null -ne ($taskWord = $taskVoice.Pop())) { Send-TaskVoiceEvent @{type='text'; text=$taskWord} }
    if ($taskVoice.Failure) { Send-TaskVoiceEvent @{type='error'; message=$taskVoice.Failure} }
    else { Send-TaskVoiceEvent @{type='complete'; rejected=$taskVoice.Rejected; peak=$taskVoice.PeakAudioLevel} }
    $taskVoice.Dispose()
} catch {
    Send-TaskVoiceEvent @{type='error'; message=$_.Exception.Message}
    if ($taskVoice) { $taskVoice.Dispose() }
    exit 1
}
