Для запуска SML требуется отдельно установить компилятор

# Установка SML of New Jersey
## Ubuntu-based дистрибутивы
```shell
sudo apt install smlnj
```

## Arch
```shell
pacman -S smlnj
```

## Fedora
```shell
sudo dnf install smlnj
```
## MacOS
```shell
brew install smlnj
```

Далее для запуска необходимо добавить в `.zshrc` путь до bin к SMLNJ
```shell
cd
echo 'export PATH=/usr/local/smlnj/bin:"$PATH"' >> .zshrc
```
---
# Запуск SML-кода
Переходим в папку, где лежит файл StandardML, далее прописываем команду
```shell
sml < <Filename.sml>
```

#SML