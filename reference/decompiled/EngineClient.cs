using System;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace RedBagMaster;

public class EngineClient
{
	public int Slot;

	public int Port;

	public TcpClient Tcp;

	public NetworkStream Stream;

	public StringBuilder Buf = new StringBuilder();

	public string State = "未连接";

	public string Balance = "-";

	public string Room = "-";

	public double BagMoney = 10.0;

	public Action<EngineClient, string> OnLine;

	public DateTime LastSeen = DateTime.Now;

	public void Connect(int port, Action<EngineClient, string> onLine)
	{
		Slot = port - 9100;
		Port = port;
		OnLine = onLine;
		try
		{
			Tcp = new TcpClient();
			Tcp.NoDelay = true;
			Tcp.Connect("127.0.0.1", port);
			Stream = Tcp.GetStream();
			State = "已连接";
			Thread thread = new Thread(ReadLoop);
			thread.IsBackground = true;
			thread.Start();
		}
		catch (Exception ex)
		{
			State = "连接失败: " + ex.Message;
		}
	}

	private void ReadLoop()
	{
		byte[] array = new byte[8192];
		try
		{
			while (true)
			{
				int num = Stream.Read(array, 0, array.Length);
				if (num <= 0)
				{
					break;
				}
				LastSeen = DateTime.Now;
				string @string = Encoding.UTF8.GetString(array, 0, num);
				Buf.Append(@string);
				int num2;
				while ((num2 = Buf.ToString().IndexOf('\n')) >= 0)
				{
					string text = Buf.ToString().Substring(0, num2);
					Buf.Remove(0, num2 + 1);
					string text2 = text.Trim();
					if (text2.Length > 0 && OnLine != null)
					{
						try
						{
							OnLine(this, text2);
						}
						catch (Exception)
						{
						}
					}
				}
			}
		}
		catch (Exception)
		{
			State = "已断开";
		}
	}

	public void Send(string cmd)
	{
		try
		{
			if (Stream != null)
			{
				byte[] bytes = Encoding.UTF8.GetBytes(cmd + "\n");
				Stream.Write(bytes, 0, bytes.Length);
				Stream.Flush();
			}
		}
		catch (Exception)
		{
			State = "发送失败";
		}
	}
}
