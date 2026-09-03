using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace MemoryCue.WindowsAttention
{
    internal static class Program
    {
        private const int MaximumMessageBytes = 64 * 1024;
        private const string MemoryCueWindowTitle = "Memory Cue";
        private const uint FlashwStop = 0x00000000;
        private const uint FlashwAll = 0x00000003;
        private const uint FlashwTimerNoForeground = 0x0000000C;

        [STAThread]
        private static int Main(string[] args)
        {
            if (args != null && args.Length == 1 && string.Equals(args[0], "--self-test", StringComparison.Ordinal))
            {
                return RunSelfTest();
            }

            try
            {
                string json;
                string readError;
                if (!TryReadNativeMessage(Console.OpenStandardInput(), out json, out readError))
                {
                    WriteNativeResponse(CreateResponse(false, null, 0, null, false, readError));
                    return 1;
                }

                AttentionCommand command;
                string validationError;
                if (!AttentionCommand.TryParse(json, out command, out validationError))
                {
                    WriteNativeResponse(CreateResponse(false, null, 0, null, false, validationError));
                    return 1;
                }

                IntPtr windowHandle = FindMemoryCueWindow();
                if (windowHandle == IntPtr.Zero)
                {
                    WriteNativeResponse(CreateResponse(false, command.Action, command.Count, command.Stage, false, "The open Memory Cue window was not found."));
                    return 1;
                }

                if (string.Equals(command.Action, "urgent", StringComparison.Ordinal))
                {
                    SetPersistentRedAttention(windowHandle);
                    StartFlashingUntilForeground(windowHandle);
                }
                else if (string.Equals(command.Action, "acknowledged", StringComparison.Ordinal))
                {
                    StopFlashing(windowHandle);
                    SetPersistentRedAttention(windowHandle);
                }
                else
                {
                    StopFlashing(windowHandle);
                    ClearPersistentRedAttention(windowHandle);
                }

                WriteNativeResponse(CreateResponse(true, command.Action, command.Count, command.Stage, true, null));
                return 0;
            }
            catch (Exception exception)
            {
                try
                {
                    WriteNativeResponse(CreateResponse(false, null, 0, null, false, exception.Message));
                }
                catch
                {
                    // Standard output may already be unavailable. Never write plain text to it,
                    // because that would corrupt the native-messaging protocol.
                }
                return 1;
            }
        }

        private static Dictionary<string, object> CreateResponse(
            bool ok,
            string action,
            int count,
            string stage,
            bool windowFound,
            string error)
        {
            Dictionary<string, object> response = new Dictionary<string, object>();
            response["ok"] = ok;
            response["action"] = action;
            response["count"] = count;
            response["windowFound"] = windowFound;
            if (!string.IsNullOrEmpty(stage))
            {
                response["stage"] = stage;
            }
            if (!string.IsNullOrEmpty(error))
            {
                response["error"] = error;
            }
            return response;
        }

        private static bool TryReadNativeMessage(Stream input, out string json, out string error)
        {
            json = null;
            error = null;

            byte[] header = ReadExactly(input, 4);
            if (header == null)
            {
                error = "No native-messaging request was received.";
                return false;
            }

            int length = header[0]
                | (header[1] << 8)
                | (header[2] << 16)
                | (header[3] << 24);
            if (length <= 0 || length > MaximumMessageBytes)
            {
                error = "The native-messaging request length is invalid.";
                return false;
            }

            byte[] body = ReadExactly(input, length);
            if (body == null)
            {
                error = "The native-messaging request ended before the declared length.";
                return false;
            }

            json = new UTF8Encoding(false, true).GetString(body);
            return true;
        }

        private static byte[] ReadExactly(Stream input, int length)
        {
            byte[] buffer = new byte[length];
            int offset = 0;
            while (offset < length)
            {
                int read = input.Read(buffer, offset, length - offset);
                if (read <= 0)
                {
                    return null;
                }
                offset += read;
            }
            return buffer;
        }

        private static void WriteNativeResponse(Dictionary<string, object> response)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            byte[] payload = Encoding.UTF8.GetBytes(serializer.Serialize(response));
            byte[] header = new byte[]
            {
                (byte)(payload.Length & 0xFF),
                (byte)((payload.Length >> 8) & 0xFF),
                (byte)((payload.Length >> 16) & 0xFF),
                (byte)((payload.Length >> 24) & 0xFF)
            };

            Stream output = Console.OpenStandardOutput();
            output.Write(header, 0, header.Length);
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }

        private static IntPtr FindMemoryCueWindow()
        {
            Process[] processes = Process.GetProcessesByName("brave");
            foreach (Process process in processes)
            {
                try
                {
                    if (process.MainWindowHandle != IntPtr.Zero
                        && process.MainWindowTitle.IndexOf(MemoryCueWindowTitle, StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return process.MainWindowHandle;
                    }
                }
                catch
                {
                    // A Brave process may exit while it is being inspected.
                }
                finally
                {
                    process.Dispose();
                }
            }
            return IntPtr.Zero;
        }

        private static void StartFlashingUntilForeground(IntPtr windowHandle)
        {
            FlashWindowInfo info = new FlashWindowInfo();
            info.Size = (uint)Marshal.SizeOf(typeof(FlashWindowInfo));
            info.WindowHandle = windowHandle;
            info.Flags = FlashwAll | FlashwTimerNoForeground;
            info.Count = uint.MaxValue;
            info.TimeoutMilliseconds = 0;
            FlashWindowEx(ref info);
        }

        private static void StopFlashing(IntPtr windowHandle)
        {
            FlashWindowInfo info = new FlashWindowInfo();
            info.Size = (uint)Marshal.SizeOf(typeof(FlashWindowInfo));
            info.WindowHandle = windowHandle;
            info.Flags = FlashwStop;
            info.Count = 0;
            info.TimeoutMilliseconds = 0;
            FlashWindowEx(ref info);
        }

        private static void SetPersistentRedAttention(IntPtr windowHandle)
        {
            WithTaskbar(delegate(ITaskbarList3 taskbar)
            {
                ThrowIfFailed(taskbar.SetProgressValue(windowHandle, 1UL, 1UL));
                ThrowIfFailed(taskbar.SetProgressState(windowHandle, TaskbarProgressState.Error));
            });
        }

        private static void ClearPersistentRedAttention(IntPtr windowHandle)
        {
            WithTaskbar(delegate(ITaskbarList3 taskbar)
            {
                ThrowIfFailed(taskbar.SetProgressState(windowHandle, TaskbarProgressState.NoProgress));
            });
        }

        private static void WithTaskbar(Action<ITaskbarList3> operation)
        {
            ITaskbarList3 taskbar = null;
            try
            {
                taskbar = (ITaskbarList3)new TaskbarList();
                ThrowIfFailed(taskbar.HrInit());
                operation(taskbar);
            }
            finally
            {
                if (taskbar != null && Marshal.IsComObject(taskbar))
                {
                    Marshal.FinalReleaseComObject(taskbar);
                }
            }
        }

        private static void ThrowIfFailed(int result)
        {
            if (result < 0)
            {
                Marshal.ThrowExceptionForHR(result);
            }
        }

        private static int RunSelfTest()
        {
            AttentionCommand command;
            string error;

            bool urgentValid = AttentionCommand.TryParse("{\"action\":\"urgent\",\"count\":2,\"stage\":\"15\"}", out command, out error)
                && command.Action == "urgent"
                && command.Count == 2
                && command.Stage == "15";
            bool acknowledgedValid = AttentionCommand.TryParse("{\"action\":\"acknowledged\",\"count\":1}", out command, out error)
                && command.Action == "acknowledged";
            bool clearValid = AttentionCommand.TryParse("{\"action\":\"clear\",\"count\":0}", out command, out error)
                && command.Action == "clear";
            bool invalidRejected = !AttentionCommand.TryParse("{\"action\":\"urgent\",\"count\":0}", out command, out error)
                && !AttentionCommand.TryParse("{\"action\":\"other\",\"count\":1}", out command, out error);

            if (!urgentValid || !acknowledgedValid || !clearValid || !invalidRejected)
            {
                Console.Error.WriteLine("SELF_TEST_FAILED");
                return 1;
            }

            Console.WriteLine("SELF_TEST_OK");
            return 0;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FlashWindowEx(ref FlashWindowInfo info);

        [StructLayout(LayoutKind.Sequential)]
        private struct FlashWindowInfo
        {
            public uint Size;
            public IntPtr WindowHandle;
            public uint Flags;
            public uint Count;
            public uint TimeoutMilliseconds;
        }

        private enum TaskbarProgressState
        {
            NoProgress = 0x0,
            Error = 0x4
        }

        [ComImport]
        [Guid("56FDF344-FD6D-11D0-958A-006097C9A090")]
        [ClassInterface(ClassInterfaceType.None)]
        private class TaskbarList
        {
        }

        [ComImport]
        [Guid("EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface ITaskbarList3
        {
            [PreserveSig]
            int HrInit();

            [PreserveSig]
            int AddTab(IntPtr windowHandle);

            [PreserveSig]
            int DeleteTab(IntPtr windowHandle);

            [PreserveSig]
            int ActivateTab(IntPtr windowHandle);

            [PreserveSig]
            int SetActiveAlt(IntPtr windowHandle);

            [PreserveSig]
            int MarkFullscreenWindow(IntPtr windowHandle, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);

            [PreserveSig]
            int SetProgressValue(IntPtr windowHandle, ulong completed, ulong total);

            [PreserveSig]
            int SetProgressState(IntPtr windowHandle, TaskbarProgressState state);
        }
    }

    internal sealed class AttentionCommand
    {
        private static readonly Regex StagePattern = new Regex("^[A-Za-z0-9:_-]{1,32}$", RegexOptions.CultureInvariant);

        public string Action { get; private set; }
        public int Count { get; private set; }
        public string Stage { get; private set; }

        private AttentionCommand(string action, int count, string stage)
        {
            Action = action;
            Count = count;
            Stage = stage;
        }

        public static bool TryParse(string json, out AttentionCommand command, out string error)
        {
            command = null;
            error = null;
            if (string.IsNullOrWhiteSpace(json))
            {
                error = "The command is empty.";
                return false;
            }

            Dictionary<string, object> data;
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                data = serializer.Deserialize<Dictionary<string, object>>(json);
            }
            catch
            {
                error = "The command is not valid JSON.";
                return false;
            }

            if (data == null)
            {
                error = "The command must be a JSON object.";
                return false;
            }

            object rawAction;
            string action = data.TryGetValue("action", out rawAction) ? rawAction as string : null;
            if (action != "urgent" && action != "acknowledged" && action != "clear")
            {
                error = "The action is not allowed.";
                return false;
            }

            object rawCount;
            int count;
            if (!data.TryGetValue("count", out rawCount) || !TryReadWholeNumber(rawCount, out count) || count < 0 || count > 999)
            {
                error = "Count must be a whole number from 0 to 999.";
                return false;
            }

            if ((action == "urgent" || action == "acknowledged") && count == 0)
            {
                error = "Urgent and acknowledged commands require an active count.";
                return false;
            }
            if (action == "clear" && count != 0)
            {
                error = "Clear requires a count of zero.";
                return false;
            }

            object rawStage;
            string stage = null;
            if (data.TryGetValue("stage", out rawStage) && rawStage != null)
            {
                stage = rawStage as string;
                if (stage == null || !StagePattern.IsMatch(stage))
                {
                    error = "Stage must be a short, safe string.";
                    return false;
                }
            }

            command = new AttentionCommand(action, count, stage);
            return true;
        }

        private static bool TryReadWholeNumber(object value, out int result)
        {
            result = 0;
            if (value == null || value is bool || value is string)
            {
                return false;
            }

            double numericValue;
            try
            {
                numericValue = Convert.ToDouble(value, CultureInfo.InvariantCulture);
            }
            catch
            {
                return false;
            }

            if (double.IsNaN(numericValue)
                || double.IsInfinity(numericValue)
                || numericValue != Math.Floor(numericValue)
                || numericValue < int.MinValue
                || numericValue > int.MaxValue)
            {
                return false;
            }

            result = (int)numericValue;
            return true;
        }
    }
}
