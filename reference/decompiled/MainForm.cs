using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RedBagMaster;

public class MainForm : Form
{
	private class GrabRound
	{
		public long id;

		public int phase;

		public int bagCount = 5;

		public double m1;

		public double m2;

		public double m3;

		public double m4;

		public int graber1 = -1;

		public int w2 = -1;

		public int w3 = -1;

		public int w4 = -1;

		public int w5 = -1;

		public int subSlot = -1;

		public bool subUsed;

		public bool subTried;

		public double[] mWin = new double[6];

		public bool[] gotWin = new bool[6];

		public long bagRoom;

		public double bagMoney;

		public DateTime ts;

		public bool done;
	}

	private TextBox[] linkBoxes = new TextBox[6];

	private TextBox[] proxyBoxes = new TextBox[6];

	private Button[] checkIpBtns = new Button[6];

	private TextBox[] balBoxes = new TextBox[6];

	private TextBox[] roomBoxes = new TextBox[6];

	private RichTextBox[] logBoxes = new RichTextBox[6];

	private Button[] loginBtns = new Button[6];

	private Button[] joinBtns = new Button[6];

	private Button[] changeBtns = new Button[6];

	private Button[] restartBtns = new Button[6];

	private TextBox log1Amt;

	private TextBox subDelay;

	private ComboBox hallCombo;

	private Button btnStart;

	private Button btnStop;

	private Button btnCycleModel;

	private Button btnAssignProxy;

	private Button btnBalHighFirst;

	private CheckBox chkBalLowSecond;

	private EngineClient[] eng = new EngineClient[6];

	private Process[] procs = new Process[6];

	private string exeDir;

	private string engineDir;

	private bool autoGrab;

	private string[] engState = new string[6];

	private Dictionary<long, GrabRound> rounds = new Dictionary<long, GrabRound>();

	private Dictionary<long, DateTime> bagStart = new Dictionary<long, DateTime>();

	private string memFile;

	private int instId;

	private int inst4;

	private int basePort = 9501;

	private Random rnd = new Random();

	private RichTextBox masterLog;

	private RichTextBox redbagLog;

	private Button btnExpand;

	private int firstMode;

	private int circNext;

	private int fixedFirstIdx;

	private int fixed2Idx = -1;

	private int lastGrabIdx = -1;

	private CheckBox chkBalLowLast;

	private RadioButton[] fixedFirstRadios = new RadioButton[6];

	private RadioButton[] fixed2Radios = new RadioButton[6];

	private RadioButton[] lastGrabRadios = new RadioButton[6];

	private RadioButton[] noneRadios = new RadioButton[6];

	private TextBox[] stopLossBoxes = new TextBox[6];

	private double totalGrabMoney;

	private bool skipNextBag;

	private int skipCount;

	private int grabCount;

	private HashSet<long> skippedBags = new HashSet<long>();

	private CheckBox chkSkipOne;

	private CheckBox chkSkipTwo;

	private CheckBox chkGrab2Skip2;

	private TextBox totalGrabBox;

	private string flowFile;

	private string logFile = "";

	private string[] engBindLink = new string[6];

	private string[] engBindProxy = new string[6];

	private int[] restartCount = new int[6];

	private DateTime[] lastRestartTime = new DateTime[6];

	private DateTime[] lastRestart = new DateTime[6];

	private DateTime[] lastMoneySent = new DateTime[6];

	private int[] moneyRetry = new int[6];

	private int[] missCount = new int[6];

	private DateTime[] lastBagTime = new DateTime[6];

	private bool[] offlineWarned = new bool[6];

	private bool[] restarting = new bool[6];

	private int[] changeRoomCount = new int[6];

	private string[] memLinks = new string[6];

	private int GetGameId()
	{
		int num = ((hallCombo != null && hallCombo.SelectedIndex >= 0) ? hallCombo.SelectedIndex : 0);
		if (num == 0)
		{
			return 8;
		}
		return num;
	}

	private double GetRoomMoney()
	{
		switch ((hallCombo != null && hallCombo.SelectedIndex >= 0) ? hallCombo.SelectedIndex : 0)
		{
		case 0:
		case 1:
			return 9.5;
		case 2:
			return 28.5;
		case 3:
			return 47.5;
		default:
			return 9.5;
		}
	}

	public MainForm()
	{
		string[] commandLineArgs = Environment.GetCommandLineArgs();
		for (int i = 1; i < commandLineArgs.Length; i++)
		{
			if (commandLineArgs[i] == "-i" && i + 1 < commandLineArgs.Length)
			{
				int.TryParse(commandLineArgs[i + 1], out instId);
			}
			else if (commandLineArgs[i].StartsWith("inst="))
			{
				int.TryParse(commandLineArgs[i].Substring(5), out instId);
			}
		}
		if (instId < 1)
		{
			string fileNameWithoutExtension = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]);
			Match match = Regex.Match(fileNameWithoutExtension, "多开(\\d+)");
			if (match.Success)
			{
				if (int.TryParse(match.Groups[1].Value, out var result) && result >= 1 && result <= 9)
				{
					instId = 3 + result;
				}
			}
			else
			{
				Match match2 = Regex.Match(fileNameWithoutExtension, "实例(\\d+)");
				if (match2.Success)
				{
					int.TryParse(match2.Groups[1].Value, out instId);
				}
			}
		}
		if (instId < 1)
		{
			instId = 1;
		}
		string fileNameWithoutExtension2 = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]);
		Match match3 = Regex.Match(fileNameWithoutExtension2, "四包多开(\\d+)");
		if (match3.Success)
		{
			int.TryParse(match3.Groups[1].Value, out inst4);
			if (inst4 < 1 || inst4 > 9)
			{
				inst4 = 0;
			}
		}
		bool flag = false;
		for (int j = 1; j < commandLineArgs.Length; j++)
		{
			if (!commandLineArgs[j].StartsWith("inst4=") && !commandLineArgs[j].StartsWith("inst="))
			{
				continue;
			}
			string s2 = (commandLineArgs[j].Contains("=") ? commandLineArgs[j].Substring(commandLineArgs[j].IndexOf('=') + 1) : "");
			if (int.TryParse(s2, out var result2))
			{
				inst4 = result2;
				if (inst4 < 0 || inst4 > 9)
				{
					inst4 = 0;
				}
				flag = true;
			}
		}
		if (!flag)
		{
			int result3 = 0;
			try
			{
				string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "last_inst4.txt");
				if (File.Exists(path))
				{
					int.TryParse(File.ReadAllText(path).Trim(), out result3);
				}
			}
			catch (Exception)
			{
			}
			using Form form = new Form();
			form.Text = "选择四包实例";
			form.FormBorderStyle = FormBorderStyle.FixedDialog;
			form.StartPosition = FormStartPosition.CenterScreen;
			form.Width = 320;
			form.Height = 200;
			form.MaximizeBox = false;
			form.MinimizeBox = false;
			Label value = new Label
			{
				Text = "选择要启动的四包实例(可同时开多个):",
				Location = new Point(15, 15),
				AutoSize = true
			};
			ComboBox comboBox = new ComboBox
			{
				Location = new Point(15, 45),
				Width = 270,
				DropDownStyle = ComboBoxStyle.DropDownList
			};
			comboBox.Items.AddRange(new object[6] { "主版 (端口9501-9504)", "多开1 (端口9551-9554)", "多开2 (端口9651-9654)", "多开3 (端口9751-9754)", "多开4 (端口9851-9854)", "多开5 (端口9951-9954)" });
			comboBox.SelectedIndex = ((result3 >= 0 && result3 <= 5) ? result3 : 0);
			Button button = new Button
			{
				Text = "启动",
				Location = new Point(120, 90),
				Width = 85,
				DialogResult = DialogResult.OK
			};
			Button button2 = new Button
			{
				Text = "取消",
				Location = new Point(215, 90),
				Width = 85,
				DialogResult = DialogResult.Cancel
			};
			form.Controls.Add(value);
			form.Controls.Add(comboBox);
			form.Controls.Add(button);
			form.Controls.Add(button2);
			form.AcceptButton = button;
			form.CancelButton = button2;
			if (form.ShowDialog() != DialogResult.OK)
			{
				Environment.Exit(0);
				return;
			}
			inst4 = comboBox.SelectedIndex;
			try
			{
				File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "last_inst4.txt"), inst4.ToString());
			}
			catch (Exception)
			{
			}
		}
		basePort = ((inst4 == 0) ? 9501 : (9451 + inst4 * 100));
		exeDir = AppDomain.CurrentDomain.BaseDirectory;
		engineDir = Path.Combine(exeDir, "engine");
		memFile = Path.Combine(exeDir, (inst4 == 0) ? "client_mem4x.txt" : ("client_mem4x" + inst4 + ".txt"));
		flowFile = Path.Combine(exeDir, (inst4 == 0) ? "flow.txt" : ("flow" + inst4 + ".txt"));
		logFile = Path.Combine(exeDir, (inst4 == 0) ? "运行日志.log" : ("运行日志" + inst4 + ".log"));
		try
		{
			using StreamWriter streamWriter = new StreamWriter(logFile, append: true, Encoding.UTF8);
			streamWriter.WriteLine("======== 启动 " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " 实例" + instId + " 端口 " + basePort + " ========");
		}
		catch (Exception)
		{
		}
		InitUI();
		LoadMem();
		LoadLinksToBoxes();
		Timer timer = new Timer();
		timer.Interval = 30000;
		timer.Tick += delegate
		{
			HeartbeatCheck();
		};
		timer.Start();
		List<string> localIPv4s = GetLocalIPv4s();
		MasterLog("检测到本机IP " + localIPv4s.Count + " 个: " + ((localIPv4s.Count > 0) ? string.Join(" / ", localIPv4s) : "(无, 将用默认出口)"));
		MasterLog("四包版 端口 " + basePort + "-" + (basePort + 3));
		StartEngines();
	}

	private void InitUI()
	{
		Text = "CG红包接龙通用版" + ((inst4 == 0) ? "" : (" [多开" + inst4 + "]"));
		base.ClientSize = new Size(1180, 750);
		Font = new Font("微软雅黑", 9f);
		base.FormBorderStyle = FormBorderStyle.FixedSingle;
		base.MaximizeBox = false;
		base.StartPosition = FormStartPosition.Manual;
		base.Location = new Point(50, 50);
		int num = 8;
		Label label = new Label();
		label.Text = "逻辑金额:";
		label.Location = new Point(10, num + 4);
		label.AutoSize = true;
		Label value = label;
		log1Amt = new TextBox
		{
			Location = new Point(85, num),
			Width = 50,
			Text = "2.99"
		};
		Label label2 = new Label();
		label2.Text = "补救延迟ms:";
		label2.Location = new Point(150, num + 4);
		label2.AutoSize = true;
		Label value2 = label2;
		subDelay = new TextBox
		{
			Location = new Point(230, num),
			Width = 50,
			Text = "50"
		};
		btnStart = new Button
		{
			Text = "开始抢包",
			Location = new Point(300, num - 2),
			Width = 90
		};
		btnStart.Click += delegate
		{
			StartGrab();
		};
		btnStop = new Button
		{
			Text = "停止抢包",
			Location = new Point(395, num - 2),
			Width = 90
		};
		btnStop.Click += delegate
		{
			StopGrab();
		};
		btnCycleModel = new Button
		{
			Text = "循环首抢",
			Location = new Point(490, num - 2),
			Width = 95
		};
		btnCycleModel.Click += delegate
		{
			firstMode = ((firstMode != 2) ? 2 : 0);
			UpdateModelBtns();
		};
		btnBalHighFirst = new Button
		{
			Text = "余额最高首抢",
			Location = new Point(590, num - 2),
			Width = 100
		};
		btnBalHighFirst.Click += delegate
		{
			firstMode = ((firstMode != 4) ? 4 : 0);
			UpdateModelBtns();
		};
		Label label3 = new Label();
		label3.Text = "房间:";
		label3.Location = new Point(695, num + 4);
		label3.AutoSize = true;
		Label value3 = label3;
		hallCombo = new ComboBox
		{
			Location = new Point(735, num - 2),
			Width = 90,
			DropDownStyle = ComboBoxStyle.DropDownList
		};
		hallCombo.Items.AddRange(new object[4] { "10元3包", "10元5包", "30元5包", "50元5包" });
		hallCombo.SelectedIndex = 0;
		hallCombo.SelectedIndexChanged += delegate
		{
			try
			{
				StopGrab();
			}
			catch
			{
			}
			MasterLog("已切换房间: " + hallCombo.Text + ", 自动重启所有窗口引擎...");
			try
			{
				StartEngines();
			}
			catch
			{
			}
			SaveMem();
		};
		chkBalLowSecond = new CheckBox
		{
			Text = "余额最低2抢",
			Location = new Point(835, num + 1),
			AutoSize = true
		};
		chkBalLowLast = new CheckBox
		{
			Text = "余额最低收尾",
			Location = new Point(940, num + 1),
			AutoSize = true
		};
		chkBalLowSecond.CheckedChanged += delegate
		{
			if (chkBalLowSecond.Checked && chkBalLowLast.Checked)
			{
				chkBalLowLast.Checked = false;
			}
		};
		chkBalLowLast.CheckedChanged += delegate
		{
			if (chkBalLowLast.Checked && chkBalLowSecond.Checked)
			{
				chkBalLowSecond.Checked = false;
			}
			if (chkBalLowLast.Checked)
			{
				lastGrabIdx = -1;
				for (int i = 0; i < 6; i++)
				{
					if (lastGrabRadios[i] != null)
					{
						lastGrabRadios[i].Checked = false;
					}
				}
				MasterLog("已启用余额最低自动收尾(动态)");
			}
			UpdateModelBtns();
		};
		chkBalLowSecond.CheckedChanged += delegate
		{
			if (chkBalLowSecond.Checked)
			{
				fixed2Idx = -1;
				for (int j = 0; j < 4; j++)
				{
					if (fixed2Radios[j] != null)
					{
						fixed2Radios[j].Checked = false;
					}
					if (noneRadios[j] != null)
					{
						noneRadios[j].Checked = true;
					}
				}
				MasterLog("已启用余额最低自动固定第二抢(动态)");
			}
			UpdateModelBtns();
		};
		base.Controls.Add(value);
		base.Controls.Add(log1Amt);
		base.Controls.Add(value2);
		base.Controls.Add(subDelay);
		base.Controls.Add(btnStart);
		base.Controls.Add(btnStop);
		base.Controls.Add(btnCycleModel);
		base.Controls.Add(btnBalHighFirst);
		base.Controls.Add(value3);
		base.Controls.Add(hallCombo);
		base.Controls.Add(chkBalLowSecond);
		base.Controls.Add(chkBalLowLast);
		for (int k = 0; k < 6; k++)
		{
			int num2 = 40 + k * 30;
			int num3 = 10;
			Label label4 = new Label();
			label4.Text = "游戏" + (k + 1);
			label4.Location = new Point(num3, num2 + 3);
			label4.AutoSize = true;
			label4.Font = new Font("微软雅黑", 10f, FontStyle.Bold);
			Label value4 = label4;
			base.Controls.Add(value4);
			linkBoxes[k] = new TextBox
			{
				Location = new Point(num3 + 50, num2),
				Width = 190,
				Text = ""
			};
			base.Controls.Add(linkBoxes[k]);
			Button button = new Button();
			button.Text = "清除";
			button.Location = new Point(num3 + 245, num2 - 1);
			button.Width = 48;
			Button button2 = button;
			Button button3 = new Button();
			button3.Text = "粘贴";
			button3.Location = new Point(num3 + 295, num2 - 1);
			button3.Width = 48;
			Button button4 = button3;
			int si3 = k;
			button2.Click += delegate
			{
				linkBoxes[si3].Text = "";
			};
			button4.Click += delegate
			{
				try
				{
					if (Clipboard.ContainsText())
					{
						linkBoxes[si3].Text = Clipboard.GetText().Trim();
					}
				}
				catch (Exception)
				{
				}
			};
			base.Controls.Add(button2);
			base.Controls.Add(button4);
			int si4 = k;
			loginBtns[k] = new Button
			{
				Text = "登录",
				Location = new Point(num3 + 350, num2 - 2),
				Width = 45
			};
			joinBtns[k] = new Button
			{
				Text = "进房",
				Location = new Point(num3 + 398, num2 - 2),
				Width = 45
			};
			changeBtns[k] = new Button
			{
				Text = "换桌",
				Location = new Point(num3 + 446, num2 - 2),
				Width = 45
			};
			restartBtns[k] = new Button
			{
				Text = "重启",
				Location = new Point(num3 + 494, num2 - 2),
				Width = 45
			};
			loginBtns[k].Click += delegate
			{
				if (EnsureEngine(si4))
				{
					Task.Delay(10000).ContinueWith(delegate
					{
						SendTo(si4, "{\"cmd\":\"login\"}");
					}, TaskScheduler.FromCurrentSynchronizationContext());
				}
				else
				{
					SendTo(si4, "{\"cmd\":\"login\"}");
				}
			};
			joinBtns[k].Click += delegate
			{
				if (EnsureEngine(si4))
				{
					Task.Delay(10000).ContinueWith(delegate
					{
						SendTo(si4, "{\"cmd\":\"join\"}");
					}, TaskScheduler.FromCurrentSynchronizationContext());
				}
				else
				{
					SendTo(si4, "{\"cmd\":\"join\"}");
				}
			};
			changeBtns[k].Click += delegate
			{
				if (EnsureEngine(si4))
				{
					Task.Delay(10000).ContinueWith(delegate
					{
						SendTo(si4, "{\"cmd\":\"change\"}");
					}, TaskScheduler.FromCurrentSynchronizationContext());
				}
				else
				{
					SendTo(si4, "{\"cmd\":\"change\"}");
				}
			};
			restartBtns[k].Click += delegate
			{
				try
				{
					if (procs[si4] != null && !procs[si4].HasExited)
					{
						procs[si4].Kill();
						procs[si4].WaitForExit(2000);
					}
				}
				catch
				{
				}
				try
				{
					if (eng[si4] != null && eng[si4].Tcp != null)
					{
						eng[si4].Tcp.Close();
					}
				}
				catch
				{
				}
				eng[si4] = null;
				procs[si4] = null;
				engState[si4] = "idle";
				MasterLog("窗口" + (si4 + 1) + " 手动重启引擎...");
				StartEngineOne(si4);
			};
			base.Controls.Add(loginBtns[k]);
			base.Controls.Add(joinBtns[k]);
			base.Controls.Add(changeBtns[k]);
			base.Controls.Add(restartBtns[k]);
			Label label5 = new Label();
			label5.Text = "余额";
			label5.Location = new Point(num3 + 548, num2 + 3);
			label5.AutoSize = true;
			Label value5 = label5;
			balBoxes[k] = new TextBox
			{
				Location = new Point(num3 + 585, num2),
				Width = 50,
				ReadOnly = true,
				Text = "-"
			};
			Label label6 = new Label();
			label6.Text = "桌号";
			label6.Location = new Point(num3 + 640, num2 + 3);
			label6.AutoSize = true;
			Label value6 = label6;
			roomBoxes[k] = new TextBox
			{
				Location = new Point(num3 + 678, num2),
				Width = 50,
				ReadOnly = true,
				Text = "-"
			};
			base.Controls.Add(value5);
			base.Controls.Add(balBoxes[k]);
			base.Controls.Add(value6);
			base.Controls.Add(roomBoxes[k]);
			fixedFirstRadios[k] = new RadioButton
			{
				Text = "首抢",
				Location = new Point(0, 2),
				AutoSize = true
			};
			fixed2Radios[k] = new RadioButton
			{
				Text = "2抢",
				Location = new Point(50, 2),
				AutoSize = true
			};
			lastGrabRadios[k] = new RadioButton
			{
				Text = "抢尾",
				Location = new Point(95, 2),
				AutoSize = true
			};
			noneRadios[k] = new RadioButton
			{
				Text = "无",
				Location = new Point(145, 2),
				AutoSize = true,
				Checked = true
			};
			Panel panel = new Panel();
			panel.Location = new Point(num3 + 730, num2);
			panel.Size = new Size(180, 26);
			panel.BorderStyle = BorderStyle.FixedSingle;
			Panel panel2 = panel;
			panel2.Controls.Add(fixedFirstRadios[k]);
			panel2.Controls.Add(fixed2Radios[k]);
			panel2.Controls.Add(lastGrabRadios[k]);
			panel2.Controls.Add(noneRadios[k]);
			base.Controls.Add(panel2);
			Label label7 = new Label();
			label7.Text = "止损";
			label7.Location = new Point(num3 + 920, num2 + 3);
			label7.AutoSize = true;
			Label value7 = label7;
			stopLossBoxes[k] = new TextBox
			{
				Location = new Point(num3 + 953, num2),
				Width = 45,
				Text = ""
			};
			base.Controls.Add(value7);
			base.Controls.Add(stopLossBoxes[k]);
			int si5 = k;
			fixedFirstRadios[k].Click += delegate
			{
				if (fixed2Idx == si5)
				{
					fixed2Idx = -1;
				}
				if (lastGrabIdx == si5)
				{
					lastGrabIdx = -1;
				}
				firstMode = 3;
				fixedFirstIdx = si5;
				for (int l = 0; l < 6; l++)
				{
					if (l != si5 && fixedFirstRadios[l] != null)
					{
						fixedFirstRadios[l].Checked = false;
						if (noneRadios[l] != null)
						{
							noneRadios[l].Checked = true;
						}
					}
				}
				UpdateModelBtns();
			};
			fixed2Radios[k].Click += delegate
			{
				if (firstMode == 3 && fixedFirstIdx == si5)
				{
					firstMode = 0;
					fixedFirstIdx = -1;
				}
				if (lastGrabIdx == si5)
				{
					lastGrabIdx = -1;
				}
				fixed2Idx = si5;
				if (chkBalLowSecond != null)
				{
					chkBalLowSecond.Checked = false;
				}
				for (int m = 0; m < 6; m++)
				{
					if (m != si5 && fixed2Radios[m] != null)
					{
						fixed2Radios[m].Checked = false;
						if (noneRadios[m] != null)
						{
							noneRadios[m].Checked = true;
						}
					}
				}
				MasterLog("窗口" + (si5 + 1) + " 固定第二抢(不参与首抢队列)");
				UpdateModelBtns();
			};
			lastGrabRadios[k].Click += delegate
			{
				if (firstMode == 3 && fixedFirstIdx == si5)
				{
					firstMode = 0;
					fixedFirstIdx = -1;
				}
				if (fixed2Idx == si5)
				{
					fixed2Idx = -1;
				}
				lastGrabIdx = si5;
				for (int n = 0; n < 6; n++)
				{
					if (n != si5 && lastGrabRadios[n] != null)
					{
						lastGrabRadios[n].Checked = false;
						if (noneRadios[n] != null)
						{
							noneRadios[n].Checked = true;
						}
					}
				}
				MasterLog("窗口" + (si5 + 1) + " 固定抢尾(只抢最后一包)");
				UpdateModelBtns();
			};
			noneRadios[k].Click += delegate
			{
				fixed2Idx = -1;
				lastGrabIdx = -1;
				if (firstMode == 3 && fixedFirstIdx == si5)
				{
					firstMode = 0;
				}
				UpdateModelBtns();
				MasterLog("窗口" + (si5 + 1) + " 已取消固定设置");
			};
		}
		GroupBox groupBox = new GroupBox();
		groupBox.Text = "抢包流水";
		groupBox.Location = new Point(1050, 35);
		groupBox.Size = new Size(120, 190);
		GroupBox groupBox2 = groupBox;
		Label label8 = new Label();
		label8.Text = "累计抢到:";
		label8.Location = new Point(10, 25);
		label8.AutoSize = true;
		Label value8 = label8;
		totalGrabBox = new TextBox
		{
			Location = new Point(10, 45),
			Width = 100,
			ReadOnly = true,
			Text = "0.00",
			Font = new Font("微软雅黑", 12f, FontStyle.Bold)
		};
		Button button5 = new Button();
		button5.Text = "清空流水";
		button5.Location = new Point(10, 80);
		button5.Width = 100;
		button5.Height = 30;
		Button button6 = button5;
		button6.Click += delegate
		{
			totalGrabMoney = 0.0;
			totalGrabBox.Text = "0.00";
			SaveFlow();
		};
		chkSkipOne = new CheckBox
		{
			Text = "抢一停一",
			Location = new Point(10, 120),
			AutoSize = true
		};
		chkSkipTwo = new CheckBox
		{
			Text = "抢一停二",
			Location = new Point(10, 145),
			AutoSize = true
		};
		chkGrab2Skip2 = new CheckBox
		{
			Text = "抢二停二",
			Location = new Point(10, 170),
			AutoSize = true
		};
		groupBox2.Controls.Add(value8);
		groupBox2.Controls.Add(totalGrabBox);
		groupBox2.Controls.Add(button6);
		groupBox2.Controls.Add(chkSkipOne);
		groupBox2.Controls.Add(chkSkipTwo);
		groupBox2.Controls.Add(chkGrab2Skip2);
		base.Controls.Add(groupBox2);
		masterLog = new RichTextBox
		{
			Location = new Point(10, 230),
			Size = new Size(base.ClientSize.Width - 20, base.ClientSize.Height - 240),
			ReadOnly = true,
			BackColor = Color.FromArgb(10, 10, 10),
			ForeColor = Color.White,
			Font = new Font("Consolas", 10f)
		};
		masterLog.DetectUrls = false;
		base.Controls.Add(masterLog);
		redbagLog = masterLog;
		LoadFlow();
	}

	private void StartGrab()
	{
		autoGrab = true;
		MasterLog("开始抢包(云信实时监听, 1号/随机号最先抢)");
		EngineClient[] array = eng;
		for (int i = 0; i < array.Length; i++)
		{
			array[i]?.Send("{\"cmd\":\"status\"}");
		}
	}

	private void StopGrab()
	{
		autoGrab = false;
		MasterLog("已停止抢包(引擎保持运行)");
	}

	private void StartEngines()
	{
		if (!Directory.Exists(engineDir))
		{
			MessageBox.Show("缺少 engine 目录: " + engineDir);
			return;
		}
		int startIdx = 0;
		Timer startTimer = new Timer();
		startTimer.Interval = 1500;
		startTimer.Tick += delegate
		{
			if (startIdx >= 6)
			{
				startTimer.Stop();
				startTimer.Dispose();
			}
			else
			{
				StartEngineOne(startIdx);
				startIdx++;
			}
		};
		startTimer.Start();
	}

	private bool EnsureEngine(int i)
	{
		string text = linkBoxes[i].Text.Trim();
		if (procs[i] != null && !procs[i].HasExited && engBindLink[i] == text)
		{
			return false;
		}
		Log(i, "链接已变更, 重启引擎...");
		try
		{
			if (procs[i] != null && !procs[i].HasExited)
			{
				procs[i].Kill();
			}
		}
		catch (Exception)
		{
		}
		StartEngineOne(i);
		return true;
	}

	private void KillPort(int port)
	{
		try
		{
			ProcessStartInfo processStartInfo = new ProcessStartInfo("netstat", "-ano -p tcp");
			processStartInfo.RedirectStandardOutput = true;
			processStartInfo.UseShellExecute = false;
			processStartInfo.CreateNoWindow = true;
			ProcessStartInfo startInfo = processStartInfo;
			Process process = Process.Start(startInfo);
			string text = process.StandardOutput.ReadToEnd();
			process.WaitForExit(3000);
			string[] array = text.Split('\n');
			foreach (string text2 in array)
			{
				if (text2.IndexOf(":" + port) < 0)
				{
					continue;
				}
				string[] array2 = text2.Trim().Split(new char[1] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
				if (array2.Length < 5 || !int.TryParse(array2[array2.Length - 1], out var result) || result <= 0)
				{
					continue;
				}
				try
				{
					Process processById = Process.GetProcessById(result);
					if (processById.ProcessName == "node")
					{
						processById.Kill();
						processById.WaitForExit(1000);
					}
				}
				catch
				{
				}
			}
		}
		catch
		{
		}
	}

	private void StartEngineOne(int i)
	{
		int num = basePort + i;
		string text = linkBoxes[i].Text.Trim();
		if (text.Length == 0)
		{
			Log(i, "链接为空, 跳过引擎启动");
			return;
		}
		try
		{
			KillPort(num);
			engBindLink[i] = text;
			engBindProxy[i] = "";
			int num2 = i * 125 + rnd.Next(0, 125);
			ProcessStartInfo processStartInfo = new ProcessStartInfo();
			processStartInfo.FileName = Path.Combine(engineDir, "node.exe");
			processStartInfo.Arguments = "\"" + engineDir + "\\engine.js\" " + num + " \"" + text + "\" " + (i + 1) + " \"\" \"" + engBindProxy[i] + "\" " + GetGameId() + " 0 " + num2;
			processStartInfo.WorkingDirectory = engineDir;
			processStartInfo.UseShellExecute = false;
			processStartInfo.CreateNoWindow = true;
			processStartInfo.RedirectStandardOutput = true;
			processStartInfo.RedirectStandardError = true;
			processStartInfo.StandardOutputEncoding = Encoding.UTF8;
			processStartInfo.StandardErrorEncoding = Encoding.UTF8;
			processStartInfo.WindowStyle = ProcessWindowStyle.Hidden;
			ProcessStartInfo startInfo = processStartInfo;
			Process process = Process.Start(startInfo);
			process.EnableRaisingEvents = true;
			int exitSlot = i;
			process.Exited += delegate
			{
				try
				{
					Log(exitSlot, "引擎进程已退出");
				}
				catch
				{
				}
			};
			process.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
			{
				if (e.Data != null && e.Data.Trim().Length != 0)
				{
					string text2 = e.Data.Trim();
					if (text2.IndexOf("stack overflow", StringComparison.OrdinalIgnoreCase) >= 0 || text2.IndexOf("RuntimeError: unreachable", StringComparison.OrdinalIgnoreCase) >= 0)
					{
						Log(i, text2 + " (SDK偶发崩溃, 引擎仍可用)");
					}
					else if (text2.IndexOf("代理", StringComparison.Ordinal) >= 0 || text2.IndexOf("SOCKS5", StringComparison.OrdinalIgnoreCase) >= 0 || text2.IndexOf("绑定本机IP", StringComparison.Ordinal) >= 0 || text2.IndexOf("设备指纹", StringComparison.Ordinal) >= 0 || text2.IndexOf("失败", StringComparison.Ordinal) >= 0 || text2.IndexOf("异常", StringComparison.Ordinal) >= 0 || text2.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0 || text2.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0)
					{
						Log(i, text2);
					}
				}
			};
			process.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
			{
				if (e.Data != null && e.Data.Trim().Length > 0)
				{
					LogErr(i, "引擎输出: " + e.Data.Trim());
				}
			};
			process.BeginOutputReadLine();
			process.BeginErrorReadLine();
			procs[i] = process;
			restartCount[i] = 0;
			restarting[i] = false;
			ref DateTime reference = ref lastBagTime[i];
			reference = DateTime.Now;
			Log(i, "引擎启动 (端口 " + num + ")" + ((engBindProxy[i].Length > 0) ? (" 代理=" + engBindProxy[i]) : ""));
			eng[i] = new EngineClient();
			int si = i;
			Task.Delay(4000 + si * 1000).ContinueWith(delegate
			{
				TryConnect(si, 0);
			}, TaskScheduler.FromCurrentSynchronizationContext());
		}
		catch (Exception ex)
		{
			Log(i, "引擎启动失败: " + ex.Message);
		}
	}

	private void AutoChangeRoom(int slot)
	{
		if (changeRoomCount[slot] >= 5)
		{
			RedLog("⚠\ufe0f 窗口" + (slot + 1) + " 自动换房5次仍未匹配桌号, 已停止抢包, 请手动处理!");
			autoGrab = false;
			restarting[slot] = false;
			return;
		}
		string text = "";
		for (int i = 0; i < 6; i++)
		{
			if (i != slot && linkBoxes[i].Text.Trim().Length != 0 && eng[i] != null && eng[i].Room != "-" && eng[i].Room.Length > 0)
			{
				text = eng[i].Room;
				break;
			}
		}
		string text2 = ((eng[slot] != null) ? eng[slot].Room : "-");
		if (text.Length > 0 && text2 == text)
		{
			Log(slot, "已匹配桌号 " + text2);
			restarting[slot] = false;
			return;
		}
		changeRoomCount[slot]++;
		Log(slot, "换房中(" + changeRoomCount[slot] + "/5), 当前桌号" + text2 + ", 目标桌号" + ((text.Length > 0) ? text : "未知"));
		SendTo(slot, "{\"cmd\":\"change\"}");
		Task.Delay(5000).ContinueWith(delegate
		{
			try
			{
				BeginInvoke((Action)delegate
				{
					AutoChangeRoom(slot);
				});
			}
			catch
			{
			}
		});
	}

	private void HeartbeatCheck()
	{
		for (int i = 0; i < 6; i++)
		{
			if (linkBoxes[i].Text.Trim().Length != 0 && procs[i] != null && procs[i].HasExited)
			{
				RedLog("⚠\ufe0f 窗口" + (i + 1) + " 引擎进程已退出, 请手动重启!");
				procs[i] = null;
			}
		}
	}

	private void CheckOffline()
	{
	}

	private void SendTo(int slot, string json)
	{
		if (eng[slot] == null || eng[slot].Stream == null)
		{
			Log(slot, "引擎未连接");
		}
		else
		{
			eng[slot].Send(json);
		}
	}

	private void TryConnect(int si, int retry)
	{
		try
		{
			eng[si].Connect(basePort + si, delegate(EngineClient e, string line)
			{
				HandleLine(si, line);
			});
			Log(si, "TCP 已连接");
		}
		catch (Exception ex)
		{
			Log(si, "连接失败(" + (retry + 1) + "/3): " + ex.Message);
			if (retry >= 2)
			{
				return;
			}
			Task.Delay(2000).ContinueWith(delegate
			{
				try
				{
					BeginInvoke((Action)delegate
					{
						TryConnect(si, retry + 1);
					});
				}
				catch
				{
				}
			});
		}
	}

	private void RestartEngine(int i)
	{
		if (DateTime.Now - lastRestart[i] < TimeSpan.FromSeconds(15.0))
		{
			Log(i, "引擎刚重启过, 跳过本次重启(防止循环)");
			return;
		}
		restarting[i] = true;
		ref DateTime reference = ref lastRestart[i];
		reference = DateTime.Now;
		Log(i, "引擎崩溃 → 自动重启...");
		try
		{
			if (procs[i] != null && !procs[i].HasExited)
			{
				procs[i].Kill();
				procs[i].WaitForExit(2000);
			}
		}
		catch
		{
		}
		try
		{
			if (eng[i] != null)
			{
				if (eng[i].Tcp != null)
				{
					eng[i].Tcp.Close();
				}
				eng[i] = null;
			}
		}
		catch
		{
		}
		engState[i] = "idle";
		try
		{
			roomBoxes[i].Text = "-";
		}
		catch
		{
		}
		Task.Delay(1000).ContinueWith(delegate
		{
			try
			{
				BeginInvoke((Action)delegate
				{
					try
					{
						StartEngineOne(i);
					}
					catch (Exception ex)
					{
						Log(i, "重启失败: " + ex.Message);
						return;
					}
					Task.Delay(8000 + i * 1000).ContinueWith(delegate
					{
						SendTo(i, "{\"cmd\":\"login\"}");
						Log(i, "已自动登录, 自动进房...");
						Task.Delay(3000).ContinueWith(delegate
						{
							SendTo(i, "{\"cmd\":\"join\"}");
							changeRoomCount[i] = 0;
							AutoChangeRoom(i);
						}, TaskScheduler.FromCurrentSynchronizationContext());
					}, TaskScheduler.FromCurrentSynchronizationContext());
				});
			}
			catch (Exception ex2)
			{
				Log(i, "重启失败: " + ex2.Message);
			}
		});
	}

	private void CheckIpClicked(int slot)
	{
		if (eng[slot] == null || eng[slot].Stream == null)
		{
			Log(slot, "引擎未连接, 无法检测IP");
			return;
		}
		Log(slot, "检测真实IP中...");
		SendTo(slot, "{\"cmd\":\"checkip\"}");
	}

	private void AssignProxies()
	{
		using PromptForm promptForm = new PromptForm("分配代理", "粘贴代理列表, 一行一个 (格式: ip|端口|账号|密码  或  ip:端口)\n按顺序自动分配到 窗口1/2/3/4, 超出忽略:");
		if (promptForm.ShowDialog(this) != DialogResult.OK)
		{
			return;
		}
		List<string> list = new List<string>();
		string[] array = promptForm.tb.Text.Split(new char[5] { '\n', '\r', ',', ';', '；' }, StringSplitOptions.RemoveEmptyEntries);
		foreach (string text in array)
		{
			string text2 = text.Trim();
			if (text2.Length > 0)
			{
				list.Add(text2);
			}
		}
		for (int j = 0; j < 5; j++)
		{
			proxyBoxes[j].Text = ((j < list.Count) ? list[j] : "");
		}
		MasterLog("代理分配完成: " + ((list.Count > 0) ? string.Join(" / ", list.GetRange(0, Math.Min(4, list.Count))) : "空列表"));
	}

	private void HandleLine(int slot, string line)
	{
		try
		{
			switch (J.Str(line, "type"))
			{
			case "evt":
			{
				string msg = J.Str(line, "ev");
				Log(slot, msg);
				break;
			}
			case "money":
			{
				string text7 = J.Raw(line, "balance");
				string text8 = J.Raw(line, "err");
				if (text7.Length > 0 && text7 != "null" && text7 != "undefined")
				{
					eng[slot].Balance = text7.Trim('"');
					balBoxes[slot].Text = eng[slot].Balance;
					moneyRetry[slot] = 0;
				}
				if (!(text8 == "1") || moneyRetry[slot] >= 5)
				{
					break;
				}
				moneyRetry[slot]++;
				int s4 = slot;
				Task.Delay(1000).ContinueWith(delegate
				{
					try
					{
						BeginInvoke((Action)delegate
						{
							ref DateTime reference2 = ref lastMoneySent[s4];
							reference2 = DateTime.MinValue;
							MoneyQuery(s4);
						});
					}
					catch (Exception)
					{
					}
				});
				break;
			}
			case "joinres":
			{
				string text2 = J.Str(line, "room");
				engState[slot] = "joined";
				if (text2.Length > 0)
				{
					eng[slot].Room = text2;
					roomBoxes[slot].Text = text2;
				}
				string s = J.Str(line, "bagMoney");
				double result = 0.0;
				double.TryParse(s, out result);
				if (result > 0.0)
				{
					eng[slot].BagMoney = result * 0.95;
					Log(slot, "房间包总额: " + eng[slot].BagMoney.ToString("0.00"));
				}
				break;
			}
			case "loginres":
			{
				ref DateTime reference = ref lastMoneySent[slot];
				reference = DateTime.MinValue;
				moneyRetry[slot] = 0;
				MoneyQuery(slot);
				break;
			}
			case "status":
			{
				string s2 = J.Raw(line, "st");
				string text3 = J.Str(s2, "balance");
				if (text3.Length > 0 && text3 != "null")
				{
					eng[slot].Balance = text3.Trim('"');
					balBoxes[slot].Text = eng[slot].Balance;
				}
				break;
			}
			case "ip":
			{
				string text9 = J.Str(line, "ip");
				J.Str(line, "proxy");
				if (text9.StartsWith("PROXY:"))
				{
					string text10 = text9.Substring(6);
					Log(slot, "检测服务被代理限制, 代理入口IP: " + text10 + " (短效代理入口≈出口)");
					MessageBox.Show("窗口" + (slot + 1) + " 代理入口IP: " + text10 + "\n(代理仅放行游戏域名, 无法回显出口; 短效代理入口即出口)", "检测IP", MessageBoxButtons.OK, MessageBoxIcon.Asterisk);
				}
				else
				{
					Log(slot, "真实IP: " + ((text9.Length > 0) ? text9 : "未知"));
					MessageBox.Show("窗口" + (slot + 1) + " 真实IP: " + ((text9.Length > 0) ? text9 : "未知"), "检测IP", MessageBoxButtons.OK, MessageBoxIcon.Asterisk);
				}
				break;
			}
			case "grabres":
			{
				long id = long.Parse(J.Str(line, "id"));
				string text4 = J.Raw(line, "res");
				string code = J.Str(text4, "code");
				string text5 = J.Str(text4, "money");
				string text6 = J.Str(text4, "realGrabMoney");
				if (text6.Length == 0)
				{
					text6 = text5;
				}
				HandleGrabRes(slot, id, code, text5, text6, text4);
				break;
			}
			case "bag":
				HandleMainRoomBag(slot, line);
				break;
			case "bagid":
			{
				long.TryParse(J.Str(line, "id"), out var result2);
				int.TryParse(J.Str(line, "btype"), out var result3);
				if (result3 == 1)
				{
					HandleNewBag(slot, result2);
				}
				break;
			}
			case "err":
			{
				string text = J.Str(line, "msg");
				LogErr(slot, "引擎错误: " + text);
				if (text.Contains("SDK已崩溃") || text.Contains("SDK已损坏"))
				{
					RedLog("⚠\ufe0f 窗口" + (slot + 1) + " SDK已损坏, 请手动重启引擎!");
				}
				break;
			}
			}
		}
		catch (Exception ex2)
		{
			Log(slot, "解析异常: " + ex2.Message);
		}
	}

	private void HandleMainRoomBag(int slot, string line)
	{
		try
		{
			if (slot != 0)
			{
				return;
			}
			string text = J.Raw(line, "raw");
			if (text.Length == 0)
			{
				text = line;
			}
			long.TryParse(J.Str(text, "id"), out var result);
			int.TryParse(J.Str(text, "type"), out var result2);
			if (result <= 0 || result2 <= 0)
			{
				return;
			}
			string text2 = J.Str(text, "roomID");
			string text3 = ((eng[0] != null) ? eng[0].Room : "");
			if (text2.Length > 0 && text3.Length > 0 && text2 != text3)
			{
				return;
			}
			int.TryParse(J.Str(text, "bags"), out var result3);
			int.TryParse(J.Str(text, "grab"), out var result4);
			string text4 = J.Str(text, "name");
			switch (result2)
			{
			case 1:
				bagStart[result] = DateTime.Now;
				if (bagStart.Count > 300)
				{
					DateTime dateTime = DateTime.MaxValue;
					long key = 0L;
					foreach (KeyValuePair<long, DateTime> item in bagStart)
					{
						if (item.Value < dateTime)
						{
							dateTime = item.Value;
							key = item.Key;
						}
					}
					bagStart.Remove(key);
				}
				RedbagLog("★新包 期号" + result + ((result3 > 0) ? (" 共" + result3 + "个") : ""));
				break;
			case 2:
				if (!bagStart.ContainsKey(result))
				{
					bagStart[result] = DateTime.Now;
				}
				RedbagLog("期号" + result + " " + text4 + " 领取 第" + result4 + "/" + result3 + "个");
				break;
			case 3:
			{
				string text5 = "";
				if (bagStart.TryGetValue(result, out var value))
				{
					text5 = " 用时" + Math.Max(0.1, (DateTime.Now - value).TotalSeconds).ToString("0.0") + "秒抢完";
					bagStart.Remove(result);
				}
				string text6 = J.Raw(text, "list");
				List<string> list = new List<string>();
				int startIndex = 0;
				while (true)
				{
					int num = text6.IndexOf("{", startIndex);
					if (num < 0)
					{
						break;
					}
					int num2 = text6.IndexOf("}", num);
					if (num2 < 0)
					{
						break;
					}
					string s = text6.Substring(num, num2 - num + 1);
					string text7 = J.Str(s, "name");
					string text8 = J.Str(s, "money");
					bool flag = J.Raw(s, "min") == "true";
					list.Add(text7 + "=" + text8 + (flag ? "(最低)" : ""));
					startIndex = num2 + 1;
				}
				RedbagLog("期号" + result + " 抢完" + text5 + ": " + ((list.Count > 0) ? string.Join("  ", list) : J.Str(text, "data")));
				if (!skippedBags.Contains(result))
				{
					break;
				}
				skippedBags.Remove(result);
				for (int i = 0; i < 6; i++)
				{
					if (eng[i] != null && engState[i] == "joined")
					{
						try
						{
							TryGrab(i, result, null);
						}
						catch
						{
						}
					}
				}
				break;
			}
			}
		}
		catch (Exception)
		{
		}
	}

	private void RedbagLog(string msg)
	{
		try
		{
			if (redbagLog.InvokeRequired)
			{
				redbagLog.BeginInvoke((Action)delegate
				{
					RedbagLog(msg);
				});
				return;
			}
			if (redbagLog.TextLength > 6000)
			{
				redbagLog.Text = redbagLog.Text.Substring(redbagLog.TextLength - 3000);
			}
			redbagLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + "\n");
			redbagLog.SelectionStart = redbagLog.TextLength;
			redbagLog.ScrollToCaret();
			FileLog("红包详情", msg);
		}
		catch (Exception)
		{
		}
	}

	private void UpdateModelBtns()
	{
		btnCycleModel.Text = ((firstMode == 2) ? "循环首抢✓" : "循环首抢");
		btnBalHighFirst.Text = ((firstMode == 4) ? "余额最高首抢✓" : "余额最高首抢");
		for (int i = 0; i < 6; i++)
		{
			if (fixedFirstRadios[i] != null)
			{
				fixedFirstRadios[i].Checked = firstMode == 3 && fixedFirstIdx == i;
			}
			if (chkBalLowSecond != null && chkBalLowSecond.Checked)
			{
				if (fixed2Radios[i] != null)
				{
					fixed2Radios[i].Checked = false;
				}
			}
			else if (fixed2Radios[i] != null)
			{
				fixed2Radios[i].Checked = fixed2Idx == i;
			}
			if (lastGrabRadios[i] != null)
			{
				lastGrabRadios[i].Checked = lastGrabIdx == i;
			}
			bool flag = firstMode == 3 && fixedFirstIdx == i;
			bool flag2 = !chkBalLowSecond.Checked && fixed2Idx == i;
			bool flag3 = lastGrabIdx == i;
			if (noneRadios[i] != null)
			{
				noneRadios[i].Checked = !flag && !flag2 && !flag3;
			}
		}
	}

	private void HandleNewBag(int slot, long id)
	{
		if (!autoGrab)
		{
			return;
		}
		ref DateTime reference = ref lastBagTime[slot];
		reference = DateTime.Now;
		offlineWarned[slot] = false;
		if (id <= 0 || rounds.ContainsKey(id))
		{
			return;
		}
		int num = 0;
		if (chkSkipOne != null && chkSkipOne.Checked)
		{
			num = 1;
		}
		if (chkSkipTwo != null && chkSkipTwo.Checked)
		{
			num = 2;
		}
		if (chkGrab2Skip2 != null && chkGrab2Skip2.Checked)
		{
			if (grabCount >= 2 && skipCount < 2)
			{
				skipCount++;
				MasterLog("抢二停二: 跳过本包 " + id + " (" + skipCount + "/2)");
				GrabRound grabRound = new GrabRound();
				grabRound.id = id;
				grabRound.ts = DateTime.Now;
				grabRound.done = true;
				GrabRound grabRound2 = grabRound;
				grabRound2.bagCount = ((hallCombo.SelectedIndex == 0) ? 3 : 5);
				rounds[id] = grabRound2;
				skippedBags.Add(id);
				if (skipCount >= 2)
				{
					grabCount = 0;
					skipCount = 0;
				}
				return;
			}
			grabCount++;
		}
		else if (num > 0 && skipCount > 0)
		{
			skipCount--;
			MasterLog("抢一停" + num + ": 跳过本包 " + id + " (剩" + skipCount + "个)");
			GrabRound grabRound3 = new GrabRound();
			grabRound3.id = id;
			grabRound3.ts = DateTime.Now;
			grabRound3.done = true;
			GrabRound grabRound4 = grabRound3;
			grabRound4.bagCount = ((hallCombo.SelectedIndex == 0) ? 3 : 5);
			rounds[id] = grabRound4;
			skippedBags.Add(id);
			return;
		}
		skipCount = num;
		GrabRound grabRound5 = new GrabRound();
		grabRound5.id = id;
		grabRound5.ts = DateTime.Now;
		GrabRound grabRound6 = grabRound5;
		grabRound6.bagCount = ((hallCombo.SelectedIndex == 0) ? 3 : 5);
		long.TryParse(eng[slot].Room, out grabRound6.bagRoom);
		grabRound6.bagMoney = eng[slot].BagMoney;
		rounds[id] = grabRound6;
		if (rounds.Count > 50)
		{
			List<long> list = new List<long>();
			foreach (KeyValuePair<long, GrabRound> round in rounds)
			{
				if (round.Value.done && round.Value.ts < DateTime.Now.AddSeconds(-60.0))
				{
					list.Add(round.Key);
				}
			}
			foreach (long item in list)
			{
				rounds.Remove(item);
			}
		}
		MasterLog("★新红包 " + id + " (来自窗口" + (slot + 1) + ")");
		int num2 = 0;
		for (int i = 0; i < 6; i++)
		{
			if (linkBoxes[i].Text.Trim().Length == 0)
			{
				continue;
			}
			double result = 0.0;
			double.TryParse(eng[i].Balance, out result);
			double result2 = 0.0;
			double.TryParse(stopLossBoxes[i].Text, out result2);
			if (result2 > 0.0 && result < result2)
			{
				MasterLog("窗口" + (i + 1) + " 余额" + result.ToString("0.00") + " < 止损" + result2.ToString("0.00") + " → 关闭引擎");
				try
				{
					if (procs[i] != null && !procs[i].HasExited)
					{
						procs[i].Kill();
						procs[i].WaitForExit(2000);
					}
				}
				catch
				{
				}
				eng[i] = null;
				procs[i] = null;
				engState[i] = "stopped";
			}
			else
			{
				num2++;
			}
		}
		int num3 = ((grabRound6.bagCount == 3) ? 3 : 5);
		if (num2 < num3)
		{
			autoGrab = false;
			MasterLog("★可参与抢包窗口仅剩 " + num2 + " 个(<" + num3 + "), 已强制停止抢包");
			UpdateModelBtns();
			return;
		}
		int[] array = new int[num2];
		int num4 = 0;
		for (int j = 0; j < 6; j++)
		{
			if (linkBoxes[j].Text.Trim().Length != 0)
			{
				double result3 = 0.0;
				double.TryParse(eng[j].Balance, out result3);
				double result4 = 0.0;
				double.TryParse(stopLossBoxes[j].Text, out result4);
				if (!(result4 > 0.0) || !(result3 < result4))
				{
					array[num4++] = j;
				}
			}
		}
		int num5 = -1;
		if (firstMode == 2)
		{
			num5 = array[circNext % num2];
			circNext = (circNext + 1) % num2;
		}
		else if (firstMode == 4)
		{
			double num6 = -1.0;
			num5 = array[0];
			for (int k = 0; k < num2; k++)
			{
				double result5 = 0.0;
				double.TryParse(eng[array[k]].Balance, out result5);
				if (result5 > num6)
				{
					num6 = result5;
					num5 = array[k];
				}
			}
			MasterLog("余额最高首抢 → 窗口" + (num5 + 1) + " 余额" + num6.ToString("0.00"));
		}
		else if (firstMode == 3)
		{
			num5 = fixedFirstIdx;
			bool flag = false;
			for (int l = 0; l < num2; l++)
			{
				if (array[l] == fixedFirstIdx)
				{
					flag = true;
					break;
				}
			}
			if (!flag)
			{
				num5 = array[rnd.Next(num2)];
				MasterLog("固定首抢窗口未登录, 本轮随机首抢");
			}
		}
		else
		{
			num5 = array[0];
		}
		int num7 = -1;
		if (chkBalLowSecond != null && chkBalLowSecond.Checked)
		{
			double num8 = double.MaxValue;
			int num9 = -1;
			for (int m = 0; m < num2; m++)
			{
				int num10 = array[m];
				if (num10 != num5)
				{
					double result6 = 0.0;
					double.TryParse(eng[num10].Balance, out result6);
					if (result6 < num8)
					{
						num8 = result6;
						num9 = num10;
					}
				}
			}
			num7 = num9;
		}
		else if (fixed2Idx >= 0)
		{
			if (fixed2Idx != num5)
			{
				for (int n = 0; n < num2; n++)
				{
					if (array[n] == fixed2Idx)
					{
						num7 = fixed2Idx;
						break;
					}
				}
			}
			if (num7 < 0)
			{
				MasterLog("注意: 固定2抢窗口和首抢窗口重复, 2抢窗口自动取消");
			}
		}
		int num11 = -1;
		if (chkBalLowLast != null && chkBalLowLast.Checked)
		{
			double num12 = double.MaxValue;
			int num13 = -1;
			for (int num14 = 0; num14 < num2; num14++)
			{
				int num15 = array[num14];
				if (num15 != num5 && num15 != num7)
				{
					double result7 = 0.0;
					double.TryParse(eng[num15].Balance, out result7);
					if (result7 < num12)
					{
						num12 = result7;
						num13 = num15;
					}
				}
			}
			num11 = num13;
			if (num11 >= 0)
			{
				MasterLog("余额最低收尾 → 窗口" + (num11 + 1) + " 余额" + num12.ToString("0.00"));
			}
		}
		else if (lastGrabIdx >= 0)
		{
			if (lastGrabIdx != num5 && lastGrabIdx != num7)
			{
				for (int num16 = 0; num16 < num2; num16++)
				{
					if (array[num16] == lastGrabIdx)
					{
						num11 = lastGrabIdx;
						break;
					}
				}
			}
			if (num11 < 0)
			{
				MasterLog("注意: 固定抢尾窗口和首抢/2抢窗口重复, 抢尾窗口自动取消");
			}
		}
		grabRound6.graber1 = num5;
		int num17 = 0;
		int[] array2 = new int[num2];
		for (int num18 = 0; num18 < num2; num18++)
		{
			int num19 = array[num18];
			if (num19 != num5 && (num7 < 0 || num19 != num7) && (num11 < 0 || num19 != num11))
			{
				array2[num17++] = num19;
			}
		}
		int[] array3 = new int[num17];
		for (int num20 = 0; num20 < num17; num20++)
		{
			array3[num20] = array2[num20];
		}
		for (int num21 = array3.Length - 1; num21 > 0; num21--)
		{
			int num22 = rnd.Next(num21 + 1);
			int num23 = array3[num21];
			array3[num21] = array3[num22];
			array3[num22] = num23;
		}
		grabRound6.w2 = ((num7 >= 0) ? num7 : ((num17 > 0) ? array3[0] : (-1)));
		grabRound6.w3 = ((num17 > 1) ? array3[1] : (-1));
		grabRound6.w4 = ((num17 > 2) ? array3[2] : (-1));
		grabRound6.w5 = ((num11 >= 0) ? num11 : ((num17 > 0) ? array3[num17 - 1] : (-1)));
		if (num11 >= 0)
		{
			MasterLog("抢尾窗口 = 窗口" + (num11 + 1) + " (只抢最后一包)");
		}
		grabRound6.phase = 0;
		MasterLog("→ 下发窗口" + (num5 + 1) + " 抢 " + id);
		TryGrab(num5, id, grabRound6);
	}

	private bool TryGrab(int slot, long id, GrabRound r)
	{
		if (slot < 0 || slot >= 6)
		{
			MasterLog("无效窗口, 跳过抢 " + id);
			return false;
		}
		if (engState[slot] != "joined")
		{
			MasterLog("窗口" + (slot + 1) + " 未进房, 跳过抢 " + id);
			return false;
		}
		long result = 0L;
		long.TryParse(eng[slot].Room, out result);
		if (r.bagRoom > 0 && result > 0 && result != r.bagRoom)
		{
			MasterLog("窗口" + (slot + 1) + " 桌号" + eng[slot].Room + " ≠ 红包桌" + r.bagRoom + " → 跳过抢 " + id);
			return false;
		}
		SendTo(slot, "{\"cmd\":\"grab\",\"id\":" + id + "}");
		return true;
	}

	private int SubDelay()
	{
		int result = 50;
		int.TryParse(subDelay.Text.Trim(), out result);
		if (result < 0)
		{
			result = 0;
		}
		if (result > 5000)
		{
			result = 5000;
		}
		return result;
	}

	private int GetNextGrabWin(GrabRound r, int excludeSlot)
	{
		if (r.phase + 1 >= r.bagCount)
		{
			return r.w5;
		}
		if (r.phase == 1)
		{
			return r.w2;
		}
		if (r.phase == 2)
		{
			return r.w3;
		}
		if (r.phase == 3)
		{
			return r.w4;
		}
		return -1;
	}

	private void HandleGrabRes(int slot, long id, string code, string money, string realMoney, string res)
	{
		if (!autoGrab || !rounds.TryGetValue(id, out var value) || value.done)
		{
			return;
		}
		double result = 0.0;
		double.TryParse(realMoney, out result);
		bool flag = code == "200" && result > 0.0;
		if (value.phase == 0)
		{
			if (!flag)
			{
				LogMiss(slot, id, code, money);
				missCount[slot]++;
				MasterLog("窗口" + (slot + 1) + " 第1包未抢到(" + missCount[slot] + "次)");
				value.done = true;
				return;
			}
			missCount[slot] = 0;
			value.m1 = result;
			value.mWin[slot] = result;
			value.gotWin[slot] = true;
			AddFlow(result);
			MasterLog("窗口" + (slot + 1) + " 抢到 " + result.ToString("0.00"));
			MoneyQuery(slot);
			double num = double.Parse(log1Amt.Text.Trim());
			if (result >= num)
			{
				value.done = true;
				return;
			}
			value.phase = 1;
			int nextGrabWin = GetNextGrabWin(value, slot);
			if (nextGrabWin >= 0)
			{
				TryGrab(nextGrabWin, id, value);
			}
			else
			{
				value.done = true;
			}
		}
		else if (value.phase == 1)
		{
			if (flag)
			{
				missCount[slot] = 0;
				value.m2 = result;
				value.mWin[slot] = result;
				value.gotWin[slot] = true;
				AddFlow(result);
				MasterLog("窗口" + (slot + 1) + " 抢到 " + result.ToString("0.00"));
				MoneyQuery(slot);
				int bagCount = value.bagCount;
				int num2 = 2;
				if (num2 >= bagCount)
				{
					value.done = true;
					return;
				}
				double num3 = ((value.bagMoney > 0.0) ? value.bagMoney : GetRoomMoney());
				double num4 = num3 - value.m1 - value.m2;
				int num5 = bagCount - num2;
				double num6 = Math.Min(value.m1, value.m2);
				if (num5 == 1)
				{
					if (num4 < num6)
					{
						value.done = true;
						return;
					}
					value.phase = 2;
					int nextGrabWin2 = GetNextGrabWin(value, slot);
					if (nextGrabWin2 >= 0)
					{
						TryGrab(nextGrabWin2, id, value);
					}
					else
					{
						value.done = true;
					}
					return;
				}
				double num7 = num4 / (double)num5;
				if (num7 < num6)
				{
					value.done = true;
					return;
				}
				value.phase = 2;
				int nextGrabWin3 = GetNextGrabWin(value, slot);
				if (nextGrabWin3 >= 0)
				{
					TryGrab(nextGrabWin3, id, value);
				}
				else
				{
					value.done = true;
				}
			}
			else
			{
				LogMiss(slot, id, code, "");
				missCount[slot]++;
				MasterLog("窗口" + (slot + 1) + " 第2包未抢到(" + missCount[slot] + "次)");
				value.done = true;
				if (value.w2 >= 0)
				{
					MoneyQuery(value.w2);
				}
			}
		}
		else if (value.phase == 2)
		{
			if (flag)
			{
				value.m3 = result;
				value.mWin[slot] = result;
				value.gotWin[slot] = true;
				AddFlow(result);
				MasterLog("窗口" + (slot + 1) + " 抢到 " + result.ToString("0.00"));
				MoneyQuery(slot);
				int bagCount2 = value.bagCount;
				int num8 = 3;
				if (num8 >= bagCount2)
				{
					value.done = true;
					return;
				}
				double num9 = ((value.bagMoney > 0.0) ? value.bagMoney : GetRoomMoney());
				double num10 = num9 - value.m1 - value.m2 - value.m3;
				int num11 = bagCount2 - num8;
				double num12 = Math.Min(Math.Min(value.m1, value.m2), value.m3);
				if (num11 == 1)
				{
					if (num10 < num12)
					{
						value.done = true;
						return;
					}
					value.phase = 3;
					int nextGrabWin4 = GetNextGrabWin(value, slot);
					if (nextGrabWin4 >= 0)
					{
						TryGrab(nextGrabWin4, id, value);
					}
					else
					{
						value.done = true;
					}
					return;
				}
				double num13 = num10 / (double)num11;
				if (num13 < num12)
				{
					value.done = true;
					return;
				}
				value.phase = 3;
				int nextGrabWin5 = GetNextGrabWin(value, slot);
				if (nextGrabWin5 >= 0)
				{
					TryGrab(nextGrabWin5, id, value);
				}
				else
				{
					value.done = true;
				}
			}
			else
			{
				LogMiss(slot, id, code, "");
				MasterLog("窗口" + (slot + 1) + " 第3包未抢到 " + id);
				value.done = true;
			}
		}
		else if (value.phase == 3)
		{
			if (value.m4 == 0.0 && flag)
			{
				value.m4 = result;
				value.mWin[slot] = result;
				value.gotWin[slot] = true;
				AddFlow(result);
				MasterLog("窗口" + (slot + 1) + " 抢到 " + result.ToString("0.00"));
				MoneyQuery(slot);
				if (4 >= value.bagCount)
				{
					value.done = true;
					return;
				}
				double num14 = ((value.bagMoney > 0.0) ? value.bagMoney : GetRoomMoney());
				double num15 = num14 - value.m1 - value.m2 - value.m3 - value.m4;
				double num16 = Math.Min(Math.Min(value.m1, value.m2), Math.Min(value.m3, value.m4));
				if (num15 < num16)
				{
					value.done = true;
					return;
				}
				value.phase = 4;
				int nextGrabWin6 = GetNextGrabWin(value, slot);
				if (nextGrabWin6 >= 0)
				{
					TryGrab(nextGrabWin6, id, value);
				}
				else
				{
					value.done = true;
				}
			}
			else if (!flag)
			{
				LogMiss(slot, id, code, "");
				MasterLog("窗口" + (slot + 1) + " 第4包未抢到 " + id);
				value.done = true;
			}
		}
		else if (value.phase == 4)
		{
			if (flag)
			{
				value.mWin[slot] = result;
				value.gotWin[slot] = true;
				AddFlow(result);
				MasterLog("窗口" + (slot + 1) + " 抢到 " + result.ToString("0.00"));
				MoneyQuery(slot);
			}
			else
			{
				MasterLog("窗口" + (slot + 1) + " 抢尾未抢到 → 本轮结束");
			}
			value.done = true;
		}
	}

	private void MoneyQuery(int slot)
	{
		if (slot >= 0 && slot < 6 && !(DateTime.Now - lastMoneySent[slot] < TimeSpan.FromMilliseconds(500.0)))
		{
			ref DateTime reference = ref lastMoneySent[slot];
			reference = DateTime.Now;
			SendTo(slot, "{\"cmd\":\"money\"}");
		}
	}

	private void AddFlow(double m)
	{
		totalGrabMoney += m;
		if (totalGrabBox != null)
		{
			totalGrabBox.Text = totalGrabMoney.ToString("0.00");
		}
		SaveFlow();
	}

	private void LoadFlow()
	{
		try
		{
			if (File.Exists(flowFile))
			{
				double.TryParse(File.ReadAllText(flowFile), out totalGrabMoney);
				if (totalGrabBox != null)
				{
					totalGrabBox.Text = totalGrabMoney.ToString("0.00");
				}
			}
		}
		catch
		{
		}
	}

	private void SaveFlow()
	{
		try
		{
			File.WriteAllText(flowFile, totalGrabMoney.ToString("0.00"));
		}
		catch
		{
		}
	}

	private void LoadMem()
	{
		try
		{
			if (!File.Exists(memFile))
			{
				return;
			}
			string[] array = File.ReadAllLines(memFile, Encoding.UTF8);
			for (int i = 0; i < 6 && i < array.Length; i++)
			{
				memLinks[i] = array[i];
			}
			int num = 6;
			if (array.Length > num)
			{
				log1Amt.Text = array[num++];
			}
			if (array.Length > num)
			{
				subDelay.Text = array[num++];
			}
			if (array.Length > num)
			{
				int result = 0;
				int.TryParse(array[num++], out result);
				firstMode = ((result >= 0 && result <= 4) ? result : 0);
			}
			if (array.Length > num)
			{
				int result2 = 0;
				int.TryParse(array[num++], out result2);
				hallCombo.SelectedIndex = result2;
			}
			if (array.Length > num && chkBalLowSecond != null)
			{
				chkBalLowSecond.Checked = array[num++] == "1";
			}
			if (array.Length > num && chkBalLowLast != null)
			{
				chkBalLowLast.Checked = array[num++] == "1";
			}
			for (int j = 0; j < 6; j++)
			{
				if (array.Length <= num)
				{
					break;
				}
				stopLossBoxes[j].Text = array[num++];
			}
			UpdateModelBtns();
		}
		catch (Exception)
		{
		}
	}

	private List<string> GetLocalIPv4s()
	{
		List<string> list = new List<string>();
		try
		{
			NetworkInterface[] allNetworkInterfaces = NetworkInterface.GetAllNetworkInterfaces();
			foreach (NetworkInterface networkInterface in allNetworkInterfaces)
			{
				if (networkInterface.OperationalStatus != OperationalStatus.Up)
				{
					continue;
				}
				foreach (UnicastIPAddressInformation unicastAddress in networkInterface.GetIPProperties().UnicastAddresses)
				{
					if (unicastAddress.Address.AddressFamily == AddressFamily.InterNetwork)
					{
						string text = unicastAddress.Address.ToString();
						if (!text.StartsWith("127.") && !text.StartsWith("169.254.") && !(text == "0.0.0.0") && !list.Contains(text))
						{
							list.Add(text);
						}
					}
				}
			}
		}
		catch (Exception)
		{
		}
		return list;
	}

	private void LoadLinksToBoxes()
	{
		for (int i = 0; i < 6; i++)
		{
			linkBoxes[i].Text = memLinks[i];
		}
	}

	private void SaveMem()
	{
		try
		{
			List<string> list = new List<string>();
			for (int i = 0; i < 6; i++)
			{
				list.Add(linkBoxes[i].Text.Trim());
			}
			list.Add(log1Amt.Text.Trim());
			list.Add(subDelay.Text.Trim());
			list.Add(firstMode.ToString());
			list.Add(hallCombo.SelectedIndex.ToString());
			list.Add(chkBalLowSecond.Checked ? "1" : "0");
			list.Add(chkBalLowLast.Checked ? "1" : "0");
			for (int j = 0; j < 6; j++)
			{
				list.Add(stopLossBoxes[j].Text.Trim());
			}
			File.WriteAllLines(memFile, list.ToArray(), Encoding.UTF8);
		}
		catch (Exception)
		{
		}
	}

	private void FileLog(string tag, string msg)
	{
		try
		{
			if (logFile.Length == 0)
			{
				return;
			}
			using StreamWriter streamWriter = new StreamWriter(logFile, append: true, Encoding.UTF8);
			streamWriter.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "][" + tag + "] " + msg);
		}
		catch (Exception)
		{
		}
	}

	private void Log(int slot, string msg)
	{
		try
		{
			if (masterLog.InvokeRequired)
			{
				masterLog.BeginInvoke((Action)delegate
				{
					Log(slot, msg);
				});
				return;
			}
			string text = "[" + DateTime.Now.ToString("HH:mm:ss") + "] 窗口" + (slot + 1) + " " + msg + "\n";
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = (msg.Contains("抢到") ? Color.MediumSeaGreen : masterLog.ForeColor);
			masterLog.AppendText(text);
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = masterLog.ForeColor;
			masterLog.ScrollToCaret();
			FileLog("窗口" + (slot + 1), msg);
		}
		catch (Exception)
		{
		}
	}

	private void LogMiss(int slot, long id, string code, string extra)
	{
		string msg = "抢包 " + id + " 未抢到(" + code + ((extra != null && extra.Length > 0) ? (":" + extra) : "") + ")";
		if (code == "500" || code == "513")
		{
			Log(slot, msg);
		}
		else
		{
			LogColor(slot, msg, Color.Red);
		}
	}

	private void LogColor(int slot, string msg, Color c)
	{
		try
		{
			if (masterLog.InvokeRequired)
			{
				masterLog.BeginInvoke((Action)delegate
				{
					LogColor(slot, msg, c);
				});
				return;
			}
			if (masterLog.TextLength > 6000)
			{
				masterLog.Text = masterLog.Text.Substring(masterLog.TextLength - 3000);
			}
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = c;
			masterLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] 窗口" + (slot + 1) + " " + msg + "\n");
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = masterLog.ForeColor;
			masterLog.ScrollToCaret();
			FileLog("窗口" + (slot + 1), msg);
		}
		catch (Exception)
		{
		}
	}

	private void LogErr(int slot, string msg)
	{
		try
		{
			if (masterLog.InvokeRequired)
			{
				masterLog.BeginInvoke((Action)delegate
				{
					LogErr(slot, msg);
				});
				return;
			}
			if (masterLog.TextLength > 6000)
			{
				masterLog.Text = masterLog.Text.Substring(masterLog.TextLength - 3000);
			}
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionLength = 0;
			masterLog.SelectionColor = Color.OrangeRed;
			masterLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] 窗口" + (slot + 1) + " " + msg + "\n");
			masterLog.SelectionColor = masterLog.ForeColor;
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.ScrollToCaret();
			FileLog("窗口" + (slot + 1) + "错误", msg);
		}
		catch (Exception)
		{
		}
	}

	private void MasterLog(string msg)
	{
		try
		{
			if (masterLog.InvokeRequired)
			{
				masterLog.BeginInvoke((Action)delegate
				{
					MasterLog(msg);
				});
				return;
			}
			if (masterLog.TextLength > 20000)
			{
				masterLog.SelectionStart = 0;
				masterLog.SelectionLength = masterLog.TextLength - 10000;
				masterLog.SelectedText = "";
			}
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = (msg.Contains("抢到") ? Color.MediumSeaGreen : masterLog.ForeColor);
			masterLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + "\n");
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = masterLog.ForeColor;
			masterLog.ScrollToCaret();
			FileLog("主控", msg);
		}
		catch (Exception)
		{
		}
	}

	private void RedLog(string msg)
	{
		try
		{
			if (masterLog.InvokeRequired)
			{
				masterLog.BeginInvoke((Action)delegate
				{
					RedLog(msg);
				});
				return;
			}
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = Color.Red;
			masterLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + "\n");
			masterLog.SelectionStart = masterLog.TextLength;
			masterLog.SelectionColor = masterLog.ForeColor;
			masterLog.ScrollToCaret();
			FileLog("主控", msg);
		}
		catch (Exception)
		{
		}
	}

	protected override void OnFormClosing(FormClosingEventArgs e)
	{
		SaveMem();
		try
		{
			Process[] array = procs;
			foreach (Process process in array)
			{
				if (process != null && !process.HasExited)
				{
					process.Kill();
				}
			}
		}
		catch (Exception)
		{
		}
		base.OnFormClosing(e);
	}
}
