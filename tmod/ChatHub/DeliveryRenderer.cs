using System;
using System.Text;
using System.Text.Json;

namespace ChatHub;

public static class DeliveryRenderer
{
    // Prevent remote text from injecting Terraria item/color/chat tags.
    public static string Plain(string text) => text.Replace('[', '［').Replace(']', '］').Replace('\0', ' ');
    public static string Render(JsonElement frame, Func<long, string> userName)
    {
        var text = new StringBuilder();
        if (frame.TryGetProperty("sourceGroupName", out var source)) text.Append('[').Append(Plain(source.GetString() ?? "")).Append("] ");
        text.Append('<').Append(Plain(frame.GetProperty("authorName").GetString() ?? "ChatHub")).Append("> ");
        foreach (var segment in frame.GetProperty("segments").EnumerateArray())
        {
            switch (segment.GetProperty("type").GetString())
            {
                case "text": text.Append(Plain(segment.GetProperty("text").GetString() ?? "")); break;
                case "mention":
                    var id = segment.GetProperty("userId");
                    text.Append('@').Append(id.ValueKind == JsonValueKind.String && id.GetString() == "all" ? "所有人" : Plain(userName(id.GetInt64())));
                    break;
                case "image":
                    var url = segment.GetProperty("url").GetString()!;
                    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https")) throw new FormatException("Invalid image URL");
                    text.Append("[图片] ").Append(Plain(url));
                    break;
                default: throw new FormatException("Unsupported segment");
            }
        }
        if (text.Length > 32000) throw new FormatException("Delivery too long");
        return text.ToString();
    }
}
